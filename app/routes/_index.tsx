import type { LoaderFunctionArgs } from "react-router";
import { Form, redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};

export default function Index() {
  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: 24, fontFamily: "Inter, sans-serif" }}>
      <h1>Shopify Preorder</h1>
      <p>Controle de pré-venda por tag, previsão individual e cobrança de entrada/saldo.</p>
      <Form method="post" action="/auth/login" style={{ display: "grid", gap: 10, marginTop: 24 }}>
        <label htmlFor="shop">Domínio da loja</label>
        <input id="shop" name="shop" placeholder="sua-loja.myshopify.com" required style={{ height: 42, padding: "0 10px" }} />
        <button type="submit" style={{ height: 42, cursor: "pointer" }}>Entrar</button>
      </Form>
    </main>
  );
}
