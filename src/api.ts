import type {
  ApiRequest,
  ApiResponse,
  Session,
  Bundle,
  ProgramSummary,
} from "./domain/model";
declare global {
  interface Window {
    google?: {
      script: {
        run: any;
        url?: {
          getLocation: (callback: (location: { hash: string }) => void) => void;
        };
        history?: {
          push: (state: any, params: any, hash: string) => void;
          setChangeHandler: (callback: (event: any) => void) => void;
        };
      };
    };
  }
}
export const isGas = () => Boolean(window.google?.script?.run);
export async function request<T = any>(
  action: string,
  data: any = {},
  token = sessionStorage.getItem("roster-admin") || "",
): Promise<T> {
  const req: ApiRequest = { action, data, token };
  let result: ApiResponse;
  if (isGas())
    result = await new Promise((resolve, reject) =>
      window
        .google!.script.run.withSuccessHandler(resolve)
        .withFailureHandler(() =>
          reject(
            new Error("서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요."),
          ),
        )
        .api(req),
    );
  else {
    const response = await fetch("/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    result = await response.json();
  }
  if (!result.ok) {
    const e = new Error(result.error || "처리하지 못했습니다.") as Error & {
      code: string;
    };
    e.code = result.code || "";
    throw e;
  }
  return result.data as T;
}
export const login = (secret: string) =>
  request<Session>("login", { secret }, "");
export const bootstrap = () =>
  request<{ programs: ProgramSummary[]; serverNow: string; mode: string }>(
    "bootstrap",
  );
export const getBundle = (programId: string, token?: string) =>
  request<Bundle>("getBundle", { programId }, token);
