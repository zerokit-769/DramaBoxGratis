import axios, { AxiosError } from "axios";

let cachedToken: { token: string; deviceid: string; exp: number } | null = null;

const TOKEN_TTL_MS = 1 * 60 * 1000; // 1 jam;

export type DramaBoxToken = { token: string; deviceid: string };

export async function getDramaBoxToken(force = false): Promise<DramaBoxToken> {
  const now = Date.now();
  // if (!force && cachedToken && cachedToken.exp > now) {
  //   return { token: cachedToken.token, deviceid: cachedToken.deviceid };
  // }

  const url = process.env.DRAMABOX_TOKEN_URL!;
  if (!url) throw new Error("DRAMABOX_TOKEN_URL not set");

  const res = await axios.get(url, { timeout: 10_000 });
  const data = res.data as { token: string; deviceid: string };
  if (!data?.token || !data?.deviceid) throw new Error("Invalid token payload");

  cachedToken = {
    token: data.token,
    deviceid: data.deviceid,
    exp: now + TOKEN_TTL_MS,
  };
  return data;
}

function getTimeZoneOffset(): string {
  // format "+0700" / "-0800"
  const offsetMin = new Date().getTimezoneOffset(); // minutes, inverted sign
  const sign = offsetMin > 0 ? "-" : "+"; // JS: WIB (+0700) => -420 => sign=+
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");

  return `${sign}${hh}${mm}`;
}

export function buildHeaders(tk: DramaBoxToken) {
  return {
    "User-Agent": "okhttp/4.10.0",
    "Accept-Encoding": "gzip",
    "Content-Type": "application/json",
    tn: `Bearer ${tk.token}`,
    version: process.env.DRAMABOX_VERSION_CODE ?? "430",
    vn: process.env.DRAMABOX_VERSION_NAME ?? "4.3.0",
    cid: process.env.DRAMABOX_CID ?? "DRA1000042",
    "package-name":
      process.env.DRAMABOX_PACKAGE_NAME ?? "com.storymatrix.drama",
    apn: process.env.DRAMABOX_APN ?? "1",
    "device-id": tk.deviceid,
    language: process.env.DRAMABOX_LANGUAGE ?? "in",
    "current-language": process.env.DRAMABOX_LANGUAGE ?? "in",
    p: process.env.DRAMABOX_PLATFORM_P ?? "43",
    "time-zone": getTimeZoneOffset(),
    "content-type": "application/json; charset=UTF-8",
  } as const;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function postUpstream<T = any>(
  url: string,
  body: any,
  headers: Record<string, string>
): Promise<{ status: number; data: T }> {
  try {
    const res = await axios.post(url, body, {
      headers,
      timeout: 15_000,
      // jangan cache di layer proxy/CDN
      validateStatus: () => true, // kita teruskan status ke client
    });

    return { status: res.status, data: res.data as T };
  } catch (e) {
    const err = e as AxiosError;
    throw new Error(`Upstream error: ${err.message}`);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withTokenRetry<T = any>(
  fn: (tk: DramaBoxToken) => Promise<{ status: number; data: T }>
): Promise<{ status: number; data: T }> {
  let tk = await getDramaBoxToken();
  let res = await fn(tk);
  if (res.status === 401 || res.status === 403) {
    // refresh token sekali
    tk = await getDramaBoxToken(true);
    res = await fn(tk);
  }
  return res;
}

// === API helpers ===
export async function fetchLatest(pageNo = 1) {
  const URL = "https://dramabox.sansekai.my.id/api/dramabox/vip";
  return withTokenRetry(async (tk) => {
    const headers = buildHeaders(tk);
    const data = {
      newChannelStyle: 1,
      isNeedRank: 1,
      pageNo,
      index: 1,
      channelId: Number(process.env.DRAMABOX_PLATFORM_P ?? 43),
    };
    return postUpstream(URL, data, headers);
  });
}

export async function fetchStream(bookId: string, index = 1) {
  const URL = "https://dramabox.sansekai.my.id/api/dramabox/latest";
  return withTokenRetry(async (tk) => {
    const headers = buildHeaders(tk);
    const data = {
      boundaryIndex: 0,
      comingPlaySectionId: -1,
      index, // episode index
      currencyPlaySource: "discover_new_rec_new",
      needEndRecommend: 0,
      currencyPlaySourceName: "",
      preLoad: false,
      rid: "",
      pullCid: "",
      loadDirection: 0,
      startUpKey: "",
      bookId,
    };
    return postUpstream(URL, data, headers);
  });
}

export async function fetchSuggest(keyword: string) {
  const URL = "https://dramabox.sansekai.my.id/api/dramabox/randomdrama";
  return withTokenRetry(async (tk) => {
    const headers = buildHeaders(tk);
    const data = { keyword };
    return postUpstream(URL, data, headers);
  });
}
