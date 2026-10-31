import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Camada 1 de proteção: só confere se existe cookie de sessão.
 * Não consulta o banco — a validação real de sessão e cargo acontece
 * nos layouts, páginas, Server Actions e Route Handlers.
 */
export function proxy(request: NextRequest) {
  const hasSession = Boolean(getSessionCookie(request));
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("voltar", pathname);
    return NextResponse.redirect(url);
  }

  // Não redirecionar /login → /dashboard só porque existe um cookie: o cookie pode ser de
  // uma sessão já encerrada (expirada, senha trocada, usuário bloqueado), o que geraria um
  // loop login ↔ dashboard. Quem decide é a página de login, validando a sessão de verdade.
  return NextResponse.next();
}

export const config = {
  // Tudo, exceto API de auth, assets do Next e arquivos estáticos.
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
