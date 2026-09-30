export const WEB_MODE = import.meta.env.VITE_WEB_MODE === "true";
export const KEY_LOCATION = WEB_MODE
  ? "当前页面内存（刷新后清除）"
  : "本机服务内存";
