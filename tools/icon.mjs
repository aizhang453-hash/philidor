// 程序图标: 圆角方块底色 + 一个象牙色的兵。
// 用法: node tools/icon.mjs <颜色名> > src-tauri/icons/icon.svg
//       再 npx tauri icon src-tauri/icons/icon.svg -o src-tauri/icons
export const COLORS = {
  酒红: ["#a8384e", "#5c1426"],
  琥珀: ["#f0b445", "#a85f0c"],
  墨绿: ["#3c9067", "#164a33"],
  宝蓝: ["#4569d6", "#1b2b75"],
  紫: ["#8d5bcc", "#43206e"],
  珊瑚: ["#f47b52", "#b2381a"],
  胡桃木: ["#9a6844", "#4a2a15"],
};

/** id 是给一页里放好几个图标时用的, 免得渐变的名字撞了 */
export function iconSvg([light, dark], id = "") {
  // 底色上淡淡的棋盘格
  let checks = "";
  const cell = 103;
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++)
      if ((i + j) % 2 === 0) checks += `<rect x="${100 + i * cell}" y="${100 + j * cell}" width="${cell}" height="${cell}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg${id}" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="${light}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient>
    <linearGradient id="ivory${id}" x1="0" y1="0" x2="1" y2="0.15">
      <stop offset="0" stop-color="#fffdf7"/>
      <stop offset="0.5" stop-color="#f6eddc"/>
      <stop offset="1" stop-color="#d8c6a4"/>
    </linearGradient>
    <clipPath id="card${id}"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>
    <filter id="soft${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg${id})"/>
  <g clip-path="url(#card${id})" fill="#ffffff" opacity="0.06">${checks}</g>
  <ellipse cx="520" cy="806" rx="240" ry="30" fill="#000" opacity="0.35" filter="url(#soft${id})"/>
  <g fill="url(#ivory${id})">
    <circle cx="512" cy="318" r="104"/>
    <rect x="397" y="416" width="230" height="46" rx="23"/>
    <path d="M450 450 C452 562 420 642 350 708 L674 708 C604 642 572 562 574 450 Z"/>
    <rect x="325" y="688" width="374" height="52" rx="26"/>
    <rect x="295" y="730" width="434" height="74" rx="32"/>
  </g>
  <ellipse cx="476" cy="276" rx="34" ry="24" fill="#ffffff" opacity="0.7"/>
</svg>
`;
}

if (process.argv[1] && process.argv[1].endsWith("icon.mjs")) {
  const name = process.argv[2];
  if (!COLORS[name]) {
    console.error(`颜色: ${Object.keys(COLORS).join(" ")}`);
    process.exit(1);
  }
  process.stdout.write(iconSvg(COLORS[name]));
}
