import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

interface SendReceiptRequest {
  companyId: string;
  recipientEmail: string;
  receiptHtml: string;
  saleId?: string;
  companyName?: string;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isValidEmail = (value: string) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

export async function POST(request: Request) {
  try {
    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !supabaseServiceRoleKey
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Server email configuration is incomplete."
        },
        { status: 500 }
      );
    }

    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication is required."
        },
        { status: 401 }
      );
    }

    const accessToken = authorization.slice(7).trim();

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication token is missing."
        },
        { status: 401 }
      );
    }

    const body = await request.json() as SendReceiptRequest;

    const companyId = String(body.companyId || "").trim();
    const recipientEmail = String(body.recipientEmail || "")
      .trim()
      .toLowerCase();
    const receiptHtml = String(body.receiptHtml || "").trim();
    const saleId = String(body.saleId || "receipt").trim();
    const requestedCompanyName = String(
      body.companyName || ""
    ).trim();

    if (!companyId) {
      return NextResponse.json(
        {
          success: false,
          error: "Company ID is required."
        },
        { status: 400 }
      );
    }

    if (!recipientEmail || !isValidEmail(recipientEmail)) {
      return NextResponse.json(
        {
          success: false,
          error: "A valid destination email address is required."
        },
        { status: 400 }
      );
    }

    if (!receiptHtml) {
      return NextResponse.json(
        {
          success: false,
          error: "Receipt content is missing."
        },
        { status: 400 }
      );
    }

    if (receiptHtml.length > 500_000) {
      return NextResponse.json(
        {
          success: false,
          error: "Receipt content is too large."
        },
        { status: 413 }
      );
    }

    const authClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

    const {
      data: userData,
      error: userError
    } = await authClient.auth.getUser(accessToken);

    if (userError || !userData.user) {
      return NextResponse.json(
        {
          success: false,
          error: "Your login session is invalid or expired."
        },
        { status: 401 }
      );
    }

    const authenticatedEmail = (
      userData.user.email || ""
    ).trim().toLowerCase();

    if (!authenticatedEmail) {
      return NextResponse.json(
        {
          success: false,
          error: "The authenticated account has no email address."
        },
        { status: 403 }
      );
    }

    const adminClient = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

    const {
      data: company,
      error: companyError
    } = await adminClient
      .from("companies")
      .select(
        "id, name, operating_name, email, owner_email, app_password"
      )
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) {
      console.error(
        "Receipt email company lookup failed:",
        companyError
      );

      return NextResponse.json(
        {
          success: false,
          error: "The company email settings could not be loaded."
        },
        { status: 500 }
      );
    }

    if (!company) {
      return NextResponse.json(
        {
          success: false,
          error: "Company not found."
        },
        { status: 404 }
      );
    }

    const companyLoginEmail = String(
      company.owner_email || company.email || ""
    )
      .trim()
      .toLowerCase();

    if (authenticatedEmail !== companyLoginEmail) {
      return NextResponse.json(
        {
          success: false,
          error: "You are not authorized to send email for this company."
        },
        { status: 403 }
      );
    }

    const senderEmail = String(company.email || "").trim();
    const appPassword = String(company.app_password || "")
      .replace(/\s+/g, "")
      .trim();

    if (!senderEmail || !appPassword) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The company Gmail address or Google App Password is missing."
        },
        { status: 400 }
      );
    }

    const companyName =
      requestedCompanyName ||
      company.operating_name ||
      company.name ||
      "Our Store";

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: senderEmail,
        pass: appPassword
      }
    });

    await transporter.verify();

    await transporter.sendMail({
      from: `"${companyName}" <${senderEmail}>`,
      to: recipientEmail,
      subject: `Your Receipt from ${companyName}`,
      text:
        `Thank you for your business.\n\n` +
        `Your receipt ${saleId} is included in this email.\n\n` +
        `${companyName}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #111827;">
          <p>Thank you for your business.</p>
          <p>Your receipt is shown below.</p>

          <div
            style="
              max-width: 760px;
              margin-top: 20px;
              padding: 20px;
              border: 1px solid #d1d5db;
              border-radius: 8px;
              background: #ffffff;
            "
          >
            ${receiptHtml}
          </div>

          <p style="margin-top: 20px;">
            ${companyName}
          </p>
        </div>
      `
    });

    return NextResponse.json({
      success: true
    });

  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown receipt email error.";

    console.error("Receipt email route error:", error);

    return NextResponse.json(
      {
        success: false,
        error: message
      },
      { status: 500 }
    );
  }
}