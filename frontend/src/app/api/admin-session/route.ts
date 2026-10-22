import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  STAFF_COOKIE,
  createSessionToken,
  maxAgeForRole,
} from "@/lib/session";
import { getServerApiUrl } from "@/lib/server-api";

type PortalLoginRole = "admin" | "staff";
type PortalCredentials = ReturnType<typeof credentialsForRole>;

function isCloudRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

function credentialsForRole(role: PortalLoginRole) {
  if (role === "staff") {
    const configuredId = process.env.PIZZA_BLITZ_STAFF_ID;
    const configuredPassword = process.env.PIZZA_BLITZ_STAFF_PASSWORD;
    return {
      id: configuredId || "staff",
      password: configuredPassword || "staff123",
      isConfigured: Boolean(configuredId && configuredPassword),
      displayName: "Counter Staff",
      subjectPrefix: "staff",
      cookie: STAFF_COOKIE,
      clearCookie: ADMIN_COOKIE,
    };
  }
  const configuredId = process.env.PIZZA_BLITZ_ADMIN_ID;
  const configuredPassword = process.env.PIZZA_BLITZ_ADMIN_PASSWORD;
  return {
    id: configuredId || "admin",
    password: configuredPassword || "admin123",
    isConfigured: Boolean(configuredId && configuredPassword),
    displayName: process.env.PIZZA_BLITZ_ADMIN_NAME || "Restaurant Admin",
    subjectPrefix: "admin",
    cookie: ADMIN_COOKIE,
    clearCookie: STAFF_COOKIE,
  };
}

function credentialsMatch(id: string, password: string, credentials: PortalCredentials) {
  return id === credentials.id && password === credentials.password;
}

async function verifyManagedStaffCredentials(id: string, password: string) {
  try {
    const response = await fetch(getServerApiUrl("/api/v1/auth/staff/portal-verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        detail: data.detail || "Invalid staff credentials.",
      };
    }
    if (data.two_factor_required) {
      return {
        ok: true,
        status: response.status,
        twoFactorRequired: true,
        challengeToken: data.challenge_token,
        role: "staff",
        staffId: data.subject?.replace("staff:", "") || id,
        displayName: data.display_name || "Counter Staff",
        source: "managed",
      };
    }
    return {
      ok: true,
      status: response.status,
      staffId: data.staff_id || id,
      displayName: data.display_name || "Counter Staff",
      source: data.source || "managed",
    };
  } catch {
    return {
      ok: false,
      status: 503,
      detail: "Staff credential service is unavailable.",
    };
  }
}

async function verifyManagedAdminCredentials(id: string, password: string) {
  try {
    const response = await fetch(getServerApiUrl("/api/v1/auth/admin/portal-verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        detail: data.detail || "Invalid admin credentials.",
      };
    }
    if (data.two_factor_required) {
      return {
        ok: true,
        status: response.status,
        twoFactorRequired: true,
        challengeToken: data.challenge_token,
        role: "admin",
        adminId: data.subject?.replace("admin:", "") || id,
        displayName: data.display_name || "Restaurant Admin",
        source: "managed",
      };
    }
    return {
      ok: true,
      status: response.status,
      adminId: data.admin_id || id,
      displayName: data.display_name || "Restaurant Admin",
      source: data.source || "managed",
    };
  } catch {
    return {
      ok: false,
      status: 503,
      detail: "Admin credential service is unavailable.",
    };
  }
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const challengeToken = String(payload.challenge_token || "");
  const challengeCode = String(payload.code || "").trim();
  if (challengeToken && challengeCode) {
    const verifyResponse = await fetch(
      getServerApiUrl("/api/v1/auth/2fa/verify"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_token: challengeToken,
          code: challengeCode,
        }),
        cache: "no-store",
      }
    );
    const verified = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok) {
      return NextResponse.json(
        { detail: verified.detail || "That verification code is not valid." },
        { status: verifyResponse.status }
      );
    }
    const role: PortalLoginRole = verified.role === "staff" ? "staff" : "admin";
    const maxAge = maxAgeForRole(role);
    const token = await createSessionToken(
      {
        role,
        subject: verified.subject,
        displayName: verified.display_name,
      },
      maxAge
    );
    const response = NextResponse.json({
      ok: true,
      role,
      displayName: verified.display_name,
      twoFactorVerified: true,
      startPath: verified.start_path || (role === "staff" ? "/orders" : "/dashboard"),
    });
    response.cookies.set({
      name: role === "staff" ? STAFF_COOKIE : ADMIN_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    });
    response.cookies.set({
      name: role === "staff" ? ADMIN_COOKIE : STAFF_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const requestedRole: PortalLoginRole = payload.role === "staff" ? "staff" : "admin";
  const requestedCredentials = credentialsForRole(requestedRole);
  const adminCredentials = credentialsForRole("admin");
  const id = String(payload.id || "").trim();
  const password = String(payload.password || "");
  // In a cloud runtime a credential only counts when it was explicitly
  // configured. Otherwise the repository defaults (admin/admin123) would still
  // authenticate a deployment that forgot to set its environment variables.
  const allowUnconfiguredCredentials = !isCloudRuntime();
  const isEnvironmentAdminLogin =
    credentialsMatch(id, password, adminCredentials) &&
    (adminCredentials.isConfigured || allowUnconfiguredCredentials);
  const isRequestedRoleLogin =
    credentialsMatch(id, password, requestedCredentials) &&
    (requestedCredentials.isConfigured || allowUnconfiguredCredentials);
  const managedAdminLogin = await verifyManagedAdminCredentials(id, password);
  const adminChallenge = managedAdminLogin?.twoFactorRequired
    ? managedAdminLogin
    : null;
  const verifiedManagedAdmin =
    managedAdminLogin?.ok && !managedAdminLogin.twoFactorRequired
      ? managedAdminLogin
      : null;
  const isAdminMasterLogin = isEnvironmentAdminLogin || Boolean(verifiedManagedAdmin);
  const managedStaffLogin =
    requestedRole === "staff" && !isAdminMasterLogin
      ? await verifyManagedStaffCredentials(id, password)
      : null;
  const staffChallenge = managedStaffLogin?.twoFactorRequired
    ? managedStaffLogin
    : null;

  if (adminChallenge || staffChallenge) {
    const challenge = adminChallenge || staffChallenge!;
    return NextResponse.json({
      two_factor_required: true,
      challenge_token: challenge.challengeToken,
      role: challenge.role,
      display_name: challenge.displayName,
    });
  }

  if (
    isCloudRuntime() &&
    !requestedCredentials.isConfigured &&
    !isAdminMasterLogin &&
    !managedStaffLogin?.ok
  ) {
    return NextResponse.json(
      {
        detail:
          managedStaffLogin?.status === 401
            ? managedStaffLogin.detail
            : `Production ${requestedRole} credentials are not configured yet.`,
      },
      { status: managedStaffLogin?.status === 401 ? 401 : 503 }
    );
  }

  const role: PortalLoginRole = isAdminMasterLogin ? "admin" : requestedRole;
  const credentials = isAdminMasterLogin ? adminCredentials : requestedCredentials;
  const isManagedStaffLogin = requestedRole === "staff" && managedStaffLogin?.ok;

  if (!isAdminMasterLogin && !isRequestedRoleLogin && !isManagedStaffLogin) {
    return NextResponse.json(
      { detail: managedStaffLogin?.detail || `Invalid ${requestedRole} credentials.` },
      { status: 401 }
    );
  }

  const maxAge = maxAgeForRole(role);
  const token = await createSessionToken(
    {
      role,
      subject: verifiedManagedAdmin
        ? `admin:${verifiedManagedAdmin.adminId}`
        : isManagedStaffLogin
          ? `staff:${managedStaffLogin.staffId}`
          : `${credentials.subjectPrefix}:${id}`,
      displayName: verifiedManagedAdmin
        ? verifiedManagedAdmin.displayName
        : isManagedStaffLogin
          ? managedStaffLogin.displayName
          : credentials.displayName,
    },
    maxAge
  );
  const response = NextResponse.json({
    ok: true,
    role,
    displayName: verifiedManagedAdmin
      ? verifiedManagedAdmin.displayName
      : isManagedStaffLogin
        ? managedStaffLogin.displayName
        : credentials.displayName,
    source: verifiedManagedAdmin
      ? verifiedManagedAdmin.source
      : isManagedStaffLogin
        ? managedStaffLogin.source
        : "environment",
    startPath: requestedRole === "staff" ? "/orders" : "/dashboard",
  });
  response.cookies.set({
    name: credentials.cookie,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  response.cookies.set({
    name: credentials.clearCookie,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
