'use strict';

const zlib = require('node:zlib');

const WIDTH = 800;
const HEIGHT = 360;
const THEMES = Object.freeze({
  coastal:{seed:11,accent:[210,34,58],accent2:[45,95,135]},
  forest:{seed:23,accent:[185,24,46],accent2:[42,88,55]},
  swamp:{seed:37,accent:[180,30,48],accent2:[70,82,43]},
  mountain:{seed:47,accent:[215,38,58],accent2:[85,92,104]},
  ocean:{seed:59,accent:[205,26,52],accent2:[28,66,112]},
  deepcave:{seed:71,accent:[225,36,66],accent2:[82,45,105]},
  apex:{seed:97,accent:[242,38,52],accent2:[132,82,24]}
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const body = Buffer.concat([name, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function imageBuffer(cacheId) {
  const id = String(cacheId || '').toLowerCase();
  const theme = THEMES[id] || THEMES.coastal;
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  const put = (x, y, rgba) => {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const p = (y * WIDTH + x) * 4;
    pixels[p] = rgba[0]; pixels[p+1] = rgba[1]; pixels[p+2] = rgba[2]; pixels[p+3] = rgba[3] ?? 255;
  };
  const rect = (x0,y0,x1,y1,c) => { for(let y=Math.max(0,y0);y<Math.min(HEIGHT,y1);y+=1) for(let x=Math.max(0,x0);x<Math.min(WIDTH,x1);x+=1) put(x,y,c); };
  const line = (x0,y0,x1,y1,c,w=2) => {
    x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
    const dx=Math.abs(x1-x0), sx=x0<x1?1:-1, dy=-Math.abs(y1-y0), sy=y0<y1?1:-1; let err=dx+dy;
    while(true){rect(x0-Math.floor(w/2),y0-Math.floor(w/2),x0+Math.ceil(w/2),y0+Math.ceil(w/2),c);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}
  };
  const circle = (cx,cy,r,c) => { for(let y=-r;y<=r;y+=1) for(let x=-r;x<=r;x+=1) if(x*x+y*y<=r*r) put(cx+x,cy+y,c); };

  for (let y=0;y<HEIGHT;y+=1) {
    const fade = y / HEIGHT;
    for (let x=0;x<WIDTH;x+=1) {
      const glow = Math.max(0, 1 - Math.hypot(x-WIDTH*0.72,y-HEIGHT*0.38)/(WIDTH*0.75));
      put(x,y,[Math.round(9+theme.accent[0]*glow*0.16),Math.round(10+theme.accent[1]*glow*0.10),Math.round(13+theme.accent[2]*glow*0.10+fade*3),255]);
    }
  }
  rect(0,0,WIDTH,8,[180,18,36,255]); rect(0,HEIGHT-8,WIDTH,HEIGHT,[90,10,22,255]);
  for(let i=0;i<18;i+=1){const x=(i*theme.seed*37)%WIDTH; const y=30+((i*theme.seed*19)%(HEIGHT-60)); circle(x,y,1+(i%3),[theme.accent[0],theme.accent[1],theme.accent[2],110]);}

  const a=[...theme.accent,255], b=[...theme.accent2,255], dim=[68,18,28,255];
  if(id==='coastal'||id==='ocean'){
    for(let row=0;row<5;row+=1){const base=155+row*28;for(let x=30;x<760;x+=40){line(x,base+(x/40%2?8:0),x+22,base-(x/40%2?8:0),row%2?a:b,4);}}
    if(id==='ocean'){circle(570,120,58,dim);circle(590,112,48,[12,13,18,255]);}
  } else if(id==='forest'){
    for(let i=0;i<8;i+=1){const x=70+i*92;line(x,300,x,125-(i%3)*18,b,10);line(x,160,x-42,210,a,6);line(x,165,x+45,205,a,6);}
  } else if(id==='swamp'){
    for(let i=0;i<16;i+=1){const x=35+i*48;line(x,315,x+(i%2?10:-8),205-(i%4)*10,b,5);line(x,260,x+18,240,a,3);}
    for(let i=0;i<7;i+=1) circle(110+i*95,292+(i%2)*12,22,b);
  } else if(id==='mountain'){
    for(let i=0;i<5;i+=1){const x=20+i*170;line(x,310,x+85,105+(i%2)*35,b,8);line(x+85,105+(i%2)*35,x+165,310,a,8);}
  } else if(id==='deepcave'){
    for(let i=0;i<9;i+=1){const x=70+i*82;line(x,320,x+18,125+(i%3)*20,b,8);line(x+18,125+(i%3)*20,x+42,320,a,5);}
  } else if(id==='apex'){
    circle(400,183,104,dim); circle(400,183,76,[15,12,15,255]);
    for(let i=0;i<8;i+=1){const angle=(Math.PI*2*i)/8;line(400+Math.cos(angle)*82,183+Math.sin(angle)*82,400+Math.cos(angle)*145,183+Math.sin(angle)*145,a,9);}
    line(330,245,400,115,a,12); line(400,115,470,245,a,12); line(350,205,450,205,b,10);
  }

  const raw = Buffer.alloc((WIDTH*4+1)*HEIGHT);
  for(let y=0;y<HEIGHT;y+=1){const row=y*(WIDTH*4+1);raw[row]=0;pixels.copy(raw,row+1,y*WIDTH*4,(y+1)*WIDTH*4);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(WIDTH,0);ihdr.writeUInt32BE(HEIGHT,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:4})),chunk('IEND',Buffer.alloc(0))]);
}

const CACHE = new Map();
function cachedImageBuffer(cacheId){const id=String(cacheId||'cache').toLowerCase();if(!CACHE.has(id))CACHE.set(id,imageBuffer(id));return CACHE.get(id);}
function cacheImageAttachment(cacheId){const id=String(cacheId||'cache').toLowerCase();return{attachment:cachedImageBuffer(id),name:`nexus-${id}-cache.png`};}
function cacheImageName(cacheId){return `nexus-${String(cacheId||'cache').toLowerCase()}-cache.png`;}

module.exports={WIDTH,HEIGHT,THEMES,imageBuffer,cachedImageBuffer,cacheImageAttachment,cacheImageName};
