/** 构建时由 eas.json 注入。正式包固定连 https 服务器，登录交给网页里的邮箱验证码。 */
export const APP_ENV: string = process.env.EXPO_PUBLIC_APP_ENV || "development";
export const FIXED_BASE: string = (process.env.EXPO_PUBLIC_OLO_API_BASE || "").replace(/\/$/, "");
export const IS_RELEASE = APP_ENV === "production" || APP_ENV === "preview";
