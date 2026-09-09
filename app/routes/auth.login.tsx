import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form } from "react-router";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await login(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await login(request);
  return null;
};

export default function Login() {
  return (
    <main style={{ maxWidth: 480, margin: "80px auto", padding: 24, fontFamily: "Inter, sans-serif" }}>
      <h1>Entrar</h1>
      <Form method="post" style={{ display: "grid", gap: 10 }}>
        <label htmlFor="shop">Domínio da loja</label>
        <input id="shop" name="shop" placeholder="sua-loja.myshopify.com" required style={{ height: 42, padding: "0 10px" }} />
        <button type="submit" style={{ height: 42 }}>Continuar</button>
      </Form>
    </main>
  );
}
