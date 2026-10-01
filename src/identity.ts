export type PlayerName = { surname: string; givenName: string };
const surnames = [
  "沈",
  "林",
  "许",
  "陆",
  "顾",
  "谢",
  "温",
  "江",
  "宋",
  "苏",
  "叶",
  "白",
  "欧阳",
  "司徒",
];
const names = [
  "时珏",
  "知微",
  "听澜",
  "清和",
  "望舒",
  "云岫",
  "怀瑾",
  "见山",
  "照溪",
  "南枝",
  "予安",
  "行舟",
  "栖迟",
  "疏桐",
  "闻笙",
  "明霁",
];
export function randomName(surname?: string): PlayerName {
  const pick = (a: string[]) =>
    a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];
  return { surname: surname || pick(surnames), givenName: pick(names) };
}
export function validateName(surname: string, givenName: string): PlayerName {
  surname = surname.trim();
  givenName = givenName.trim();
  if (
    surname.length > 4 ||
    !givenName ||
    givenName.length > 8 ||
    /[\s<>\u0000-\u001f]/u.test(surname + givenName)
  )
    throw Error(
      "姓最多4字，名需要1至8字，不含空格或特殊标记。单名可留空姓氏。",
    );
  return { surname, givenName };
}
