import type { Session } from "electron";
import {
  isTrustedAppUrl,
  type TrustedWindowConfig,
} from "../security";

type SessionPermissionConfig = Pick<
  TrustedWindowConfig,
  "appRoot" | "isDev" | "devUrl"
>;

type PermissionDecision = {
  permission: string;
  isMainFrame: boolean;
  requestingUrl?: string;
  requestingOrigin?: string;
  mainFrameUrl?: string;
};

const configuredSessions = new WeakSet<Session>();

export function shouldAllowSessionPermission(
  decision: PermissionDecision,
  config: SessionPermissionConfig,
): boolean {
  if (
    decision.permission !== "clipboard-sanitized-write" ||
    !decision.isMainFrame
  ) {
    return false;
  }

  if (decision.requestingUrl) {
    return isTrustedAppUrl(decision.requestingUrl, config);
  }
  if (
    decision.requestingOrigin &&
    decision.requestingOrigin !== "null" &&
    decision.requestingOrigin !== "file://"
  ) {
    return isTrustedAppUrl(decision.requestingOrigin, config);
  }
  return Boolean(
    decision.mainFrameUrl &&
    isTrustedAppUrl(decision.mainFrameUrl, config),
  );
}

export function installSessionPermissionPolicy(
  session: Session,
  config: SessionPermissionConfig,
): void {
  if (configuredSessions.has(session)) return;

  session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        shouldAllowSessionPermission(
          {
            permission,
            isMainFrame: details.isMainFrame,
            requestingUrl: details.requestingUrl,
            mainFrameUrl: details.isMainFrame
              ? webContents.getURL()
              : undefined,
          },
          config,
        ),
      );
    },
  );

  session.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      shouldAllowSessionPermission(
        {
          permission,
          isMainFrame: details.isMainFrame,
          requestingUrl: details.requestingUrl,
          requestingOrigin,
          mainFrameUrl:
            details.isMainFrame && webContents
              ? webContents.getURL()
              : undefined,
        },
        config,
      ),
  );

  configuredSessions.add(session);
}
