#include <API/ARK/Ark.h>
#include <Points.h>

#include <algorithm>
#include <cctype>
#include <mutex>
#include <string>
#include <unordered_set>

namespace NexusEconomyBridge
{
    namespace
    {
        std::mutex TxMutex;
        std::unordered_set<std::string> CompletedTransactions;

        bool IsSafeToken(const std::string& value, size_t max_len = 128)
        {
            if (value.empty() || value.size() > max_len)
                return false;
            return std::all_of(value.begin(), value.end(), [](unsigned char c) {
                return std::isalnum(c) || c == '_' || c == '-' || c == '.' || c == ':';
            });
        }

        void ConsoleReply(APlayerController* controller, const FString& message, bool ok)
        {
            auto* shooter = static_cast<AShooterPlayerController*>(controller);
            if (shooter)
                AsaApi::GetApiUtils().SendServerMessage(shooter, ok ? FColorList::Green : FColorList::Red, "{}", message.ToString());
            Log::GetLog()->info("[NexusEconomyBridge] {}", message.ToString());
        }

        void RconReply(RCONClientConnection* connection, RCONPacket* packet, const FString& message)
        {
            FString reply = message;
            reply += "\n";
            connection->SendMessageW(packet->Id, 0, &reply);
            Log::GetLog()->info("[NexusEconomyBridge] {}", message.ToString());
        }

        bool ResolvePlayer(const FString& eos_id, AShooterPlayerController*& controller, UPrimalInventoryComponent*& inventory)
        {
            controller = AsaApi::GetApiUtils().FindPlayerFromEOSID(eos_id);
            if (!controller || !controller->GetPlayerCharacter())
                return false;
            inventory = controller->GetPlayerCharacter()->MyInventoryComponentField();
            return inventory != nullptr;
        }

        int CountBlueprint(UPrimalInventoryComponent* inventory, const FString& blueprint, TArray<UPrimalItem*>& matches)
        {
            int total = 0;
            const TArray<UPrimalItem*> items = inventory->InventoryItemsField();
            for (UPrimalItem* item : items)
            {
                if (!item || !item->ClassPrivateField() || !item->bAllowRemovalFromInventory()() || item->bIsEngram()())
                    continue;
                if (AsaApi::GetApiUtils().GetItemBlueprint(item) != blueprint)
                    continue;
                matches.Add(item);
                total += item->GetItemQuantity();
            }
            return total;
        }

        bool ResolveItemClass(const FString& blueprint, UClass*& item_class)
        {
            TSubclassOf<UObject> archetype;
            FString mutable_blueprint = blueprint;
            UVictoryCore::StringReferenceToClass(&archetype, &mutable_blueprint);
            item_class = archetype.uClass;
            return item_class != nullptr;
        }

        bool RestoreItems(UPrimalInventoryComponent* inventory, const FString& blueprint, int amount)
        {
            if (!inventory || amount <= 0)
                return false;
            UClass* item_class = nullptr;
            if (!ResolveItemClass(blueprint, item_class))
                return false;
            inventory->IncrementItemTemplateQuantity(
                item_class, amount, true, false, nullptr, nullptr,
                false, false, false, false, true, false, false, false, false, nullptr);
            return true;
        }

        bool RemoveExact(UPrimalInventoryComponent* inventory, const FString& blueprint, int needed_amount)
        {
            TArray<UPrimalItem*> matches;
            const int available = CountBlueprint(inventory, blueprint, matches);
            if (available < needed_amount)
                return false;

            int removed = 0;
            for (UPrimalItem* item : matches)
            {
                const int quantity = item->GetItemQuantity();
                if (removed + quantity > needed_amount)
                {
                    const int keep = removed + quantity - needed_amount;
                    item->SetQuantity(keep, true);
                    inventory->NotifyClientsItemStatus(item, false, false, true, false, false, nullptr, nullptr, false, false, true, false);
                    removed = needed_amount;
                    break;
                }

                removed += quantity;
                inventory->RemoveItem(&item->ItemIDField(), false, false, true, true);
                if (removed == needed_amount)
                    break;
            }
            return removed == needed_amount;
        }

        bool TransactionAlreadyCompleted(const std::string& tx_id)
        {
            std::scoped_lock lock(TxMutex);
            return CompletedTransactions.contains(tx_id);
        }

        void MarkCompleted(const std::string& tx_id)
        {
            std::scoped_lock lock(TxMutex);
            CompletedTransactions.insert(tx_id);
        }

        FString ExecuteSell(const FString& body)
        {
            TArray<FString> parsed;
            body.ParseIntoArray(parsed, L" ", true);
            if (!parsed.IsValidIndex(5))
                return "NEXUS_ERR code=usage";

            const FString eos_id = parsed[1];
            const FString blueprint = parsed[2];
            const std::string tx_id = parsed[5].ToString();
            int amount = 0;
            int payout = 0;
            try
            {
                amount = std::stoi(*parsed[3]);
                payout = std::stoi(*parsed[4]);
            }
            catch (...)
            {
                return "NEXUS_ERR code=parse";
            }

            if (amount <= 0 || amount > 100000000 || payout <= 0 || payout > 1000000 || !IsSafeToken(tx_id))
                return "NEXUS_ERR code=invalid-arguments";

            if (TransactionAlreadyCompleted(tx_id))
                return FString::Format("NEXUS_OK tx={} duplicate=true", parsed[5]);

            AShooterPlayerController* player = nullptr;
            UPrimalInventoryComponent* inventory = nullptr;
            if (!ResolvePlayer(eos_id, player, inventory))
                return FString::Format("NEXUS_ERR tx={} code=player-offline", parsed[5]);

            TArray<UPrimalItem*> matches;
            const int available = CountBlueprint(inventory, blueprint, matches);
            if (available < amount)
                return FString::Format("NEXUS_ERR tx={} code=not-enough-items available={}", parsed[5], available);

            if (!RemoveExact(inventory, blueprint, amount))
                return FString::Format("NEXUS_ERR tx={} code=remove-failed", parsed[5]);

            if (!ArkShop::Points::AddPoints(payout, eos_id))
            {
                const bool restored = RestoreItems(inventory, blueprint, amount);
                return FString::Format(
                    "NEXUS_ERR tx={} code=credit-failed restored={}",
                    parsed[5], restored ? "true" : "false");
            }

            MarkCompleted(tx_id);
            return FString::Format("NEXUS_OK tx={} removed={} credited={}", parsed[5], amount, payout);
        }

        void SellConsole(APlayerController* caller, FString* cmd, bool)
        {
            const FString result = ExecuteSell(*cmd);
            ConsoleReply(caller, result, result.StartsWith("NEXUS_OK"));
        }

        void SellRcon(RCONClientConnection* connection, RCONPacket* packet, UWorld*)
        {
            RconReply(connection, packet, ExecuteSell(packet->Body));
        }

        void PingConsole(APlayerController* caller, FString*, bool)
        {
            ConsoleReply(caller, "NEXUS_OK bridge=0.1.0 api=2.03", true);
        }

        void PingRcon(RCONClientConnection* connection, RCONPacket* packet, UWorld*)
        {
            RconReply(connection, packet, "NEXUS_OK bridge=0.1.0 api=2.03");
        }
    }

    void Load()
    {
        auto& commands = AsaApi::GetCommands();
        commands.AddConsoleCommand("NexusEconomy.Ping", &PingConsole);
        commands.AddConsoleCommand("NexusEconomy.Sell", &SellConsole);
        commands.AddRconCommand("NexusEconomy.Ping", &PingRcon);
        commands.AddRconCommand("NexusEconomy.Sell", &SellRcon);
        Log::GetLog()->info("[NexusEconomyBridge] loaded version=0.1.0");
    }

    void Unload()
    {
        auto& commands = AsaApi::GetCommands();
        commands.RemoveConsoleCommand("NexusEconomy.Ping");
        commands.RemoveConsoleCommand("NexusEconomy.Sell");
        commands.RemoveRconCommand("NexusEconomy.Ping");
        commands.RemoveRconCommand("NexusEconomy.Sell");
        std::scoped_lock lock(TxMutex);
        CompletedTransactions.clear();
        Log::GetLog()->info("[NexusEconomyBridge] unloaded");
    }
}

extern "C" __declspec(dllexport) void Plugin_Init()
{
    NexusEconomyBridge::Load();
}

extern "C" __declspec(dllexport) void Plugin_Unload()
{
    NexusEconomyBridge::Unload();
}
