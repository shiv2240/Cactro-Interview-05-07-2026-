import { useState } from "react";
import { MessageType, sendMessage } from "../../shared/messaging/protocol";

export function AuthPanel(props: {
  auth: { authenticated: boolean; email: string | null };
  onAuthChange: () => void;
  setStatus: (s: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");

  async function submit() {
    try {
      if (mode === "login") {
        await sendMessage({ type: MessageType.AUTH_LOGIN, email, password });
      } else {
        await sendMessage({ type: MessageType.AUTH_REGISTER, email, password });
      }
      props.setStatus(mode === "login" ? "Signed in" : "Account created");
      props.onAuthChange();
    } catch (e) {
      props.setStatus(e instanceof Error ? e.message : "Auth failed");
    }
  }

  if (props.auth.authenticated) {
    return (
      <div className="glass rounded-xl p-3 text-sm">
        <p>
          Signed in as <strong>{props.auth.email}</strong>
        </p>
        <button
          type="button"
          className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white dark:bg-slate-200 dark:text-slate-900"
          onClick={async () => {
            await sendMessage({ type: MessageType.AUTH_LOGOUT });
            props.onAuthChange();
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="glass space-y-2 rounded-xl p-3">
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          className={mode === "login" ? "font-bold" : "aka-muted"}
          onClick={() => setMode("login")}
        >
          Login
        </button>
        <button
          type="button"
          className={mode === "register" ? "font-bold" : "aka-muted"}
          onClick={() => setMode("register")}
        >
          Register
        </button>
      </div>
      <input
        className="aka-input w-full rounded-lg px-2 py-1.5 text-sm"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        className="aka-input w-full rounded-lg px-2 py-1.5 text-sm"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button
        type="button"
        onClick={() => void submit()}
        className="rounded-lg bg-sky-accent px-3 py-1.5 text-sm font-semibold text-white"
      >
        {mode === "login" ? "Sign in" : "Create account"}
      </button>
    </div>
  );
}
