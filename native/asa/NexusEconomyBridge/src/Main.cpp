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

        std::string ToUtf8(const FString& value)
        {
            return value.ToString();
        }

        bool IsSafeToken(const std::string& value, size_t max_len = 128)
        {
            if (value.empty() || value.size() > max_len)
                return false;
            return std::all_of(value.begin(), value.end(), [](unsigned char c) {
                return std::isalnum(c) || c == '_' || c == '-' || c == '.' || c == ':';
            });
        }

        void Reply(APlayerController* controller, const FString& message, bool ok)
        {
            auto* shooter = static_cast<AShooterPlayerController*>(controller);
            if (shooter)
            {
                AsaApi::GetApiUtils().SendServerMessage(
                    shooter,
                    ok ? FColorList::Green : FColorList::Red,
                    "%s",
                    *message);
            }
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
                item_class,
                amount,
                true,
                false,
                nullptr,
                nullptr,
                false,
                false,
                false,
                false,
                true,
                false,
                false,
                false,
                false,
                nullptr);
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

        void SellCommand(APlayerController* caller, FString* cmd, bool)
        {
            TArray<FString> parsed;
            cmd->ParseIntoArray(parsed, L" ", true);
            if (!parsed.IsValidIndex(5))
            {
                Reply(caller, L"NEXUS_ERR code=usage", false);
                return;
            }

            const FString eos_id = parsed[1];
            const FString blueprint = parsed[2];
            const std::string tx_id = ToUtf8(parsed[5]);
            int amount = 0;
            int payout = 0;
            try
            {
                amount = std::stoi(*parsed[3]);
                payout = std::stoi(*parsed[4]);
            }
            catch (...)
            {
                Reply(caller, L"NEXUS_ERR code=parse", false);
                return;
            }

            if (amount <= 0 || amount > 100000000 || payout <= 0 || payout > 1000000 || !IsSafeToken(tx_id))
            {
                Reply(caller, L"NEXUS_ERR code=invalid-arguments", false);
                return;
            }

            if (TransactionAlreadyCompleted(tx_id))
            {
                Reply(caller, FString::Format(L"NEXUS_OK tx=%s duplicate=true", *parsed[5]), true);
                return;
            }

            AShooterPlayerController* player = nullptr;
            UPrimalInventoryComponent* inventory = nullptr;
            if (!ResolvePlayer(eos_id, player, inventory))
            {
                Reply(caller, FString::Format(L"NEXUS_ERR tx=%s code=player-offline", *parsed[5]), false);
                return;
            }

            TArray<UPrimalItem*> matches;
            const int available = CountBlueprint(inventory, blueprint, matches);
            if (available < amount)
            {
                Reply(caller, FString::Format(L"NEXUS_ERR tx=%s code=not-enough-items available=%d", *parsed[5], available), false);
                return;
            }

            if (!RemoveExact(inventory, blueprint, amount))
            {
                Reply(caller, FString::Format(L"NEXUS_ERR tx=%s code=remove-failed", *parsed[5]), false);
                return;
            }

            if (!ArkShop::Points::AddPoints(payout, eos_id))
            {
                const bool restored = RestoreItems(inventory, blueprint, amount);
                Reply(caller, FString::Format(
                    L"NEXUS_ERR tx=%s code=credit-failed restored=%s",
                    *parsed[5],
                    restored ? L"true" : L"false"), false);
                return;
            }

            MarkCompleted(tx_id);
            Reply(caller, FString::Format(L"NEXUS_OK tx=%s removed=%d credited=%d", *parsed[5], amount, payout), true);
        }

        void PingCommand(APlayerController* caller, FString*, bool)
        {
            Reply(caller, L"NEXUS_OK bridge=0.1.0 api=2.03", true);
        }
    }

    void Load()
    {
        AsaApi::GetCommands().AddConsoleCommand(L"NexusEconomy.Ping", &PingCommand);
        AsaApi::GetCommands().AddConsoleCommand(L"NexusEconomy.Sell", &SellCommand);
        Log::GetLog()->info("[NexusEconomyBridge] loaded version=0.1.0");
    }

    void Unload()
    {
        AsaApi::GetCommands().RemoveConsoleCommand(L"NexusEconomy.Ping");
        AsaApi::GetCommands().RemoveConsoleCommand(L"NexusEconomy.Sell");
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
