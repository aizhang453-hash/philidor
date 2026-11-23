// 开局名: 哪些局面是开局理论 (对局回顾标「开局库」), 这盘棋下的是什么开局。
// 资料见 tools/make-openings.mjs (Lichess 的开局名清单, 英文); 大类的中文名是我们自己译的, 变例只显示大类。

export interface Openings {
  /** 局面 (FEN 前四段) → 「ECO 英文名」; "" 是开局走到半路、本身没有名字 */
  positions: Map<string, string>;
}

export function parseOpenings(data: { positions?: Record<string, string> }): Openings {
  return { positions: new Map(Object.entries(data.positions ?? {})) };
}

let loading: Promise<Openings> | undefined;

export function loadOpenings(): Promise<Openings> {
  loading ??= fetch("/book/openings.json")
    .then((r) => {
      if (!r.ok) throw new Error("读不到开局名");
      return r.json();
    })
    .then(parseOpenings)
    .catch((e) => {
      loading = undefined;
      throw e;
    });
  return loading;
}

const epd = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** 这个局面在开局理论里 */
export function isOpeningPosition(o: Openings, fen: string): boolean {
  return o.positions.has(epd(fen));
}

/** 这个局面本身的开局名 (英文全名, 像「C40 Englund Gambit」去掉 ECO); 没有名字返回 undefined */
export function openingNameOf(o: Openings, fen: string): string | undefined {
  const v = o.positions.get(epd(fen));
  return v ? v.replace(/^[A-E]\d\d\s+/, "") : undefined;
}

/** 英文全名 → 中文 (只译大类, 冒号后面的变例不要) */
export function chineseOpening(name: string): string {
  const family = name.split(":")[0].trim();
  return FAMILY[family] ?? family;
}

const FAMILY: Record<string, string> = {
  "Sicilian Defense": "西西里防御",
  "Ruy Lopez": "西班牙开局",
  "French Defense": "法兰西防御",
  "Queen's Gambit Declined": "后翼弃兵拒绝",
  "Italian Game": "意大利开局",
  "English Opening": "英国式开局",
  "King's Gambit Accepted": "王翼弃兵接受",
  "King's Indian Defense": "古印度防御",
  "Caro-Kann Defense": "卡罗-卡恩防御",
  "Nimzo-Indian Defense": "尼姆佐-印度防御",
  "Queen's Pawn Game": "后兵开局",
  "Semi-Slav Defense": "半斯拉夫防御",
  "Dutch Defense": "荷兰防御",
  "Benoni Defense": "别诺尼防御",
  "Queen's Gambit Accepted": "后翼弃兵接受",
  "Grünfeld Defense": "格林菲尔德防御",
  "Queen's Indian Defense": "新印度防御",
  "Alekhine Defense": "阿廖欣防御",
  "Scotch Game": "苏格兰开局",
  "King's Gambit Declined": "王翼弃兵拒绝",
  "Indian Defense": "印度防御",
  "Slav Defense": "斯拉夫防御",
  "Petrov's Defense": "彼得罗夫防御",
  "Four Knights Game": "四马开局",
  "Zukertort Opening": "楚克尔托特开局",
  "Scandinavian Defense": "斯堪的纳维亚防御",
  "Philidor Defense": "菲利多尔防御",
  "Réti Opening": "列蒂开局",
  "Nimzowitsch Defense": "尼姆佐维奇防御",
  "Vienna Game": "维也纳开局",
  "Bishop's Opening": "象开局",
  "Modern Defense": "现代防御",
  "King's Pawn Game": "王兵开局",
  "Van Geet Opening": "范海特开局",
  "Pterodactyl Defense": "翼手龙防御",
  "Catalan Opening": "卡塔兰开局",
  "Pirc Defense": "皮尔茨防御",
  "Bird Opening": "伯德开局",
  "Tarrasch Defense": "塔拉什防御",
  "Polish Opening": "波兰开局",
  "Neo-Grünfeld Defense": "新格林菲尔德防御",
  "Blackmar-Diemer Gambit Accepted": "布莱克马-迪默弃兵接受",
  "Bogo-Indian Defense": "波哥-印度防御",
  "King's Indian Attack": "古印度攻击",
  "Hungarian Opening": "匈牙利开局",
  "Grob Opening": "格罗布开局",
  "Nimzo-Larsen Attack": "尼姆佐-拉森攻击",
  "Center Game": "中心开局",
  "Blackmar-Diemer Gambit": "布莱克马-迪默弃兵",
  "Latvian Gambit": "拉脱维亚弃兵",
  "Ponziani Opening": "庞齐亚尼开局",
  "Vienna Gambit, with Max Lange Defense": "维也纳弃兵",
  "Queen's Indian Defense, with e3": "新印度防御",
  "Old Indian Defense": "老印度防御",
  "Rat Defense": "老鼠防御",
  "Trompowsky Attack": "特罗姆波夫斯基攻击",
  "Benko Gambit Accepted": "本科弃兵接受",
  "Latvian Gambit Accepted": "拉脱维亚弃兵接受",
  "Kádas Opening": "卡达什开局",
  "Englund Gambit": "英格伦弃兵",
  "Blackmar-Diemer Gambit Declined": "布莱克马-迪默弃兵拒绝",
  "Richter-Veresov Attack": "里希特-韦列索夫攻击",
  "Owen Defense": "欧文防御",
  "Benko Gambit": "本科弃兵",
  "Ware Opening": "韦尔开局",
  "Englund Gambit Declined": "英格伦弃兵拒绝",
  "English Defense": "英国式防御",
  "Torre Attack": "托雷攻击",
  "Three Knights Opening": "三马开局",
  "Rubinstein Opening": "鲁宾斯坦开局",
  "Lion Defense": "狮子防御",
  "Danish Gambit Accepted": "丹麦弃兵接受",
  "Benko Gambit Declined": "本科弃兵拒绝",
  "Barnes Opening": "巴恩斯开局",
  "Van't Kruijs Opening": "范特克鲁伊斯开局",
  "King's Indian Attack, with Bf5": "古印度攻击",
  "Borg Defense": "博格防御",
  "St. George Defense": "圣乔治防御",
  "Sodium Attack": "钠攻击",
  "Mikenas Defense": "米凯纳斯防御",
  "Mieses Opening": "米泽斯开局",
  "London System": "伦敦体系",
  "Elephant Gambit": "大象弃兵",
  "Rapport-Jobava System": "拉波特-约巴瓦体系",
  "Portuguese Opening": "葡萄牙开局",
  "London System, with Be2": "伦敦体系",
  "King's Pawn Opening": "王兵开局",
  "King's Knight Opening": "王马开局",
  "Colle System": "科勒体系",
  "Blumenfeld Countergambit": "布卢门菲尔德反弃兵",
  "Amar Opening": "阿马尔开局",
  "Zukertort Defense": "楚克尔托特防御",
  "Ware Defense": "韦尔防御",
  "Slav Indian": "斯拉夫-印度防御",
  "Pseudo Queen's Indian Defense": "假新印度防御",
  "Polish Opening, with d5": "波兰开局",
  "Polish Defense": "波兰防御",
  "Mexican Defense": "墨西哥防御",
  "Marienbad System": "马林巴德体系",
  "Kangaroo Defense": "袋鼠防御",
  "Horwitz Defense": "霍维茨防御",
  "Hippopotamus Defense": "河马防御",
  "Goldsmith Defense": "戈德史密斯防御",
  Formation: "阵型开局",
  "English Orangutan": "英国式猩猩开局",
  "Clemenz Opening": "克莱门茨开局",
  "Carr Defense": "卡尔防御",
  "Anderssen's Opening": "安德森开局",
  "Amazon Attack": "亚马逊攻击",
  "Zaire Defense": "扎伊尔防御",
  "Yusupov-Rubinstein System": "尤苏波夫-鲁宾斯坦体系",
  "Wade Defense": "韦德防御",
  "Vulture Defense": "秃鹫防御",
  "Valencia Opening": "瓦伦西亚开局",
  "Semi-Slav Defense Accepted": "半斯拉夫防御接受",
  "Saragossa Opening": "萨拉戈萨开局",
  "Robatsch Defense": "罗巴奇防御",
  "Rapport-Jobava System, with e6": "拉波特-约巴瓦体系",
  "Queen's Pawn, Mengarini Attack": "后兵开局",
  "Queen's Indian Defense, with e3, Bb4+ Line": "新印度防御",
  "Queen's Indian Accelerated": "新印度防御",
  "Queen's Gambit": "后翼弃兵",
  "Paleface Attack": "白脸攻击",
  "Montevideo Defense": "蒙得维的亚防御",
  "London System, with Bd3": "伦敦体系",
  "Lemming Defense": "旅鼠防御",
  "Lasker Simul Special": "拉斯克车轮战特例",
  "King's Gambit": "王翼弃兵",
  "Irish Gambit": "爱尔兰弃兵",
  "Gunderam Defense": "贡德拉姆防御",
  "Global Opening": "环球开局",
  "Fried Fox Defense": "炸狐狸防御",
  "East Indian Defense": "东印度防御",
  "Döry Defense": "多里防御",
  "Duras Gambit": "杜拉斯弃兵",
  "Dresden Opening": "德累斯顿开局",
  "Danish Gambit Declined": "丹麦弃兵拒绝",
  "Danish Gambit": "丹麦弃兵",
  "Czech Defense": "捷克防御",
  "Creepy Crawly Formation": "爬行阵型",
  "Center Game Accepted": "中心开局接受",
  "Canard Opening": "鸭子开局",
  "Bongcloud Attack": "邦克劳德攻击",
  "Blumenfeld Countergambit Accepted": "布卢门菲尔德反弃兵接受",
  "Basque Opening": "巴斯克开局",
  "Barnes Defense": "巴恩斯防御",
  "Australian Defense": "澳大利亚防御",
  "Amsterdam Attack": "阿姆斯特丹攻击",
};
