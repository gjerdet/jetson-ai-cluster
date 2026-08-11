import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Sender melding til Telegram via Lovable connector-gateway. */
export const sendTelegram = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({ chatId: z.string().min(1), text: z.string().min(1).max(3500) }).parse(data),
  )
  .handler(async ({ data }) => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const connKey = process.env["TELEGRAM_API_KEY"];
    if (!lovableKey || !connKey)
      return { ok: false as const, error: "Telegram er ikke koblet til i prosjektet." };

    const res = await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: data.chatId, text: data.text }),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false as const, error: `Telegram [${res.status}]: ${body}` };
    try {
      const json = JSON.parse(body) as { ok?: boolean; description?: string };
      if (json.ok === false)
        return { ok: false as const, error: json.description ?? "Ukjent Telegram-feil" };
    } catch {
      /* ignorer */
    }
    return { ok: true as const };
  });
