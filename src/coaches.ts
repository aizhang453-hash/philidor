// 教练: 开始菜单「教练」里选, 对局回顾里讲话的框旁边是选的教练 (说的话以后接本机大语言模型)。
// 选的存在这台电脑上 (localStorage)。

export interface Coach {
  id: string;
  name: string;
  avatar: string;
}

export const COACHES: Coach[] = [
  // 照片: 斯坦尼茨 1896 年 (Universal Photo Parlors), 公有领域, 经维基共享资源; 见 资源出处.md
  { id: "steinitz", name: "斯坦尼茨", avatar: "/avatars/steinitz.jpg" },
];

const KEY = "philidor:coach";

export function coachOf(id: string | null | undefined): Coach {
  return COACHES.find((c) => c.id === id) ?? COACHES[0];
}

/** 选的教练 (没选过、或者选的那位以后没了, 就是第一位) */
export function loadCoach(): Coach {
  try {
    return coachOf(localStorage.getItem(KEY));
  } catch {
    return COACHES[0];
  }
}

export function saveCoach(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 存不了就算了 */
  }
}
