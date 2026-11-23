// 名字旁边的默认头像 (自己画的):
//   public/avatars/player.svg  玩家: 灰蓝底上一个象牙色的兵 (跟程序图标的兵一样)
//   public/avatars/coach.svg   教练 (还没有教练角色时先用): 胡桃木底上一个象牙色的兵 (就是程序图标的样子)
//   public/avatars/engine.svg  没有自己头像的引擎: 胡桃木底上一块电脑芯片
// 用法: node tools/avatar.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const IVORY = `<linearGradient id="ivory" x1="0" y1="0" x2="1" y2="0.15">
      <stop offset="0" stop-color="#fffdf7"/>
      <stop offset="0.5" stop-color="#f6eddc"/>
      <stop offset="1" stop-color="#d8c6a4"/>
    </linearGradient>`;

function tile(light, dark, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="${light}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient>
    ${IVORY}
  </defs>
  <rect width="256" height="256" rx="56" fill="url(#bg)"/>
${body}
</svg>
`;
}

// 程序图标里的兵 (1024 见方里画的), 缩小放进 256 见方
const pawn = `  <g transform="translate(-20.5 -22) scale(0.29)">
    <ellipse cx="520" cy="806" rx="230" ry="26" fill="#000" opacity="0.3"/>
    <g fill="url(#ivory)">
      <circle cx="512" cy="318" r="104"/>
      <rect x="397" y="416" width="230" height="46" rx="23"/>
      <path d="M450 450 C452 562 420 642 350 708 L674 708 C604 642 572 562 574 450 Z"/>
      <rect x="325" y="688" width="374" height="52" rx="26"/>
      <rect x="295" y="730" width="434" height="74" rx="32"/>
    </g>
    <ellipse cx="476" cy="276" rx="34" ry="24" fill="#fff" opacity="0.7"/>
  </g>`;

// 芯片: 中间一块, 四边各四个脚
let pins = "";
for (let i = 0; i < 4; i++) {
  const p = 86 + i * 24;
  pins += `<rect x="${p}" y="44" width="12" height="26" rx="5"/><rect x="${p}" y="186" width="12" height="26" rx="5"/>`;
  pins += `<rect x="44" y="${p}" width="26" height="12" rx="5"/><rect x="186" y="${p}" width="26" height="12" rx="5"/>`;
}
const chip = `  <g fill="url(#ivory)">${pins}
    <rect x="62" y="62" width="132" height="132" rx="20"/>
  </g>
  <rect x="92" y="92" width="72" height="72" rx="10" fill="none" stroke="#6b4a30" stroke-width="8" opacity="0.75"/>
  <circle cx="80" cy="80" r="6" fill="#6b4a30" opacity="0.6"/>`;

mkdirSync("public/avatars", { recursive: true });
writeFileSync("public/avatars/player.svg", tile("#6f7c8c", "#363d47", pawn));
writeFileSync("public/avatars/engine.svg", tile("#9a6844", "#4a2a15", chip));
writeFileSync("public/avatars/coach.svg", tile("#9a6844", "#4a2a15", pawn));
console.log("画好了 public/avatars/player.svg、engine.svg、coach.svg");
