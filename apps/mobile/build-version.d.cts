export const MAX_VERSION_CODE: number;
export function computeBuild(input: {
  appVersion: string;
  override: string | undefined;
  readGit: () => { count: string | number; shallow: boolean };
}): { versionCode: number; version: string };
