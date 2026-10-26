// 在 app.json 之上按 APP_ENV 调整：production 去掉局域网/明文 http 例外，只走 https。
// APP_ENV=development（默认）保留本地调试用的局域网 http。
module.exports = ({ config }) => {
  const env = process.env.APP_ENV || "development";
  const prod = env === "production" || env === "preview";
  const ios = { ...config.ios, infoPlist: { ...config.ios.infoPlist } };
  if (prod) {
    delete ios.infoPlist.NSAppTransportSecurity;
    delete ios.infoPlist.NSLocalNetworkUsageDescription;
  }
  const base = process.env.EXPO_PUBLIC_OLO_API_BASE || "";
  if (prod && !/^https:\/\//.test(base)) {
    throw new Error("APP_ENV=" + env + " 需要 EXPO_PUBLIC_OLO_API_BASE=https://...");
  }
  return {
    ...config,
    ios,
    android: { ...config.android, usesCleartextTraffic: !prod },
    extra: { ...(config.extra || {}), appEnv: env },
  };
};
