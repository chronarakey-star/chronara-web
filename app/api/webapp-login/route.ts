import { createClient } from "@supabase/supabase-js";
import {
  pbkdf2Sync,
  timingSafeEqual,
} from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoginBody = {
  username?: unknown;
  password?: unknown;
};

type WebAppCredential = {
  id: string;
  company_id: string;
  password_hash: string;
  updated_at: string;
};

function normalizeUsername(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function verifyPassword(
  enteredPassword: string,
  savedHash: string
): boolean {
  try {
    const parts = savedHash.split("$");

    /*
      Expected format:

      $pbkdf2-sha256$600000<SALT><DIGEST>
    */
    if (
      parts.length !== 5 ||
      parts[0] !== "" ||
      parts[1] !== "pbkdf2-sha256"
    ) {
      return false;
    }

    const iterations = Number(parts[2]);
    const saltHex = parts[3];
    const expectedHex = parts[4];

    if (
      !Number.isSafeInteger(iterations) ||
      iterations < 100_000 ||
      iterations > 2_000_000
    ) {
      return false;
    }

    if (
      !/^[0-9a-f]+$/i.test(saltHex) ||
      saltHex.length % 2 !== 0 ||
      !/^[0-9a-f]+$/i.test(expectedHex) ||
      expectedHex.length % 2 !== 0
    ) {
      return false;
    }

    const salt = Buffer.from(saltHex, "hex");
    const expectedDigest = Buffer.from(
      expectedHex,
      "hex"
    );

    const calculatedDigest = pbkdf2Sync(
      Buffer.from(enteredPassword, "utf8"),
      salt,
      iterations,
      expectedDigest.length,
      "sha256"
    );

    return (
      calculatedDigest.length ===
        expectedDigest.length &&
      timingSafeEqual(
        calculatedDigest,
        expectedDigest
      )
    );
  } catch {
    return false;
  }
}

function invalidLogin() {
  return NextResponse.json(
    {
      success: false,
      message:
        "The Web App username or password is incorrect.",
    },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = String(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
    ).trim();

    const publicKey = String(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
    ).trim();

    const serviceRoleKey = String(
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
    ).trim();

    if (
      !supabaseUrl ||
      !publicKey ||
      !serviceRoleKey
    ) {
      console.error(
        "Web App login environment variables are missing."
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "The Web App login service is not configured.",
        },
        { status: 500 }
      );
    }

    let body: LoginBody;

    try {
      body = (await request.json()) as LoginBody;
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: "The login request was invalid.",
        },
        { status: 400 }
      );
    }

    const username = normalizeUsername(
      body.username
    );

    const password = String(
      body.password ?? ""
    );

    if (
      !username ||
      !password ||
      !/^[a-z0-9._-]+$/.test(username)
    ) {
      return invalidLogin();
    }

    const adminClient = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );

    const {
      data: credential,
      error: credentialError,
    } = await adminClient
      .from("web_app_users")
      .select(
        "id, company_id, password_hash, updated_at"
      )
      .eq("username_normalized", username)
      .eq("is_active", true)
      .eq("is_deleted", false)
      .maybeSingle<WebAppCredential>();

    if (credentialError) {
      console.error(
        "Web App credential lookup failed:",
        credentialError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "Chronara Key could not verify the login.",
        },
        { status: 500 }
      );
    }

    if (
      !credential ||
      !verifyPassword(
        password,
        credential.password_hash
      )
    ) {
      return invalidLogin();
    }

    const publicClient = createClient(
      supabaseUrl,
      publicKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );

    const {
      data: authData,
      error: authError,
    } =
      await publicClient.auth.signInAnonymously();

    if (
      authError ||
      !authData.user ||
      !authData.session
    ) {
      console.error(
        "Anonymous Web App login failed:",
        authError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "Chronara Key could not create the login session.",
        },
        { status: 500 }
      );
    }

    const now = new Date().toISOString();

    const {
      data: updatedCredential,
      error: loginUpdateError,
    } = await adminClient
      .from("web_app_users")
      .update({
        last_login_at: now,
      })
      .eq("id", credential.id)
      .eq("company_id", credential.company_id)
      .select("updated_at")
      .single();

    if (
      loginUpdateError ||
      !updatedCredential?.updated_at
    ) {
      console.error(
        "Web App last-login update failed:",
        loginUpdateError
      );

      await adminClient.auth.admin.deleteUser(
        authData.user.id
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "Chronara Key could not prepare the login session.",
        },
        { status: 500 }
      );
    }

    const { error: grantError } =
      await adminClient
        .from("web_app_access_grants")
        .upsert(
          {
            auth_user_id: authData.user.id,
            company_id:
              credential.company_id,
            web_app_user_id: credential.id,
            credential_updated_at:
              updatedCredential.updated_at,
            credential_password_hash:
              credential.password_hash,
            created_at: now,
            last_verified_at: now,
            revoked_at: null,
          },
          {
            onConflict: "auth_user_id",
          }
        );

    if (grantError) {
      console.error(
        "Web App grant creation failed:",
        grantError
      );

      await adminClient.auth.admin.deleteUser(
        authData.user.id
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "Chronara Key could not authorize the login session.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        company_id:
          credential.company_id,
        access_token:
          authData.session.access_token,
        refresh_token:
          authData.session.refresh_token,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "Web App login route failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "Chronara Key could not connect to the login service.",
      },
      { status: 500 }
    );
  }
}