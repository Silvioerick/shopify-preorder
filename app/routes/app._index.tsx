import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  disablePreorderMetafield,
  getProductSnapshot,
  syncPreorderDeposit,
} from "../services/preorder.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [rules, configs, productResponse] = await Promise.all([
    prisma.preorderTagRule.findMany({
      where: { shop, active: true },
      orderBy: { tag: "asc" },
    }),
    prisma.productPreorder.findMany({
      where: { shop },
      include: {
        tagRule: true,
        reservations: {
          select: { quantity: true, status: true, balanceTotal: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    admin.graphql(`#graphql
      query PreorderAdminProducts {
        products(first: 100, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id
            title
            handle
            status
            tags
            featuredMedia {
              preview { image { url altText } }
            }
            variants(first: 1) {
              nodes { id price inventoryQuantity }
            }
          }
        }
      }
    `),
  ]);

  const productBody = await productResponse.json() as any;
  const products = (productBody.data?.products?.nodes || [])
    .filter((product: any) => !product.tags?.includes("__preorder_deposit"))
    .map((product: any) => {
      const matchedRule = rules.find((rule) => product.tags?.includes(rule.tag));
      const config = configs.find((item) => item.shopifyProductId === product.id);
      const variant = product.variants?.nodes?.[0];
      const sold = config?.reservations
        .filter((reservation) => !["CANCELLED", "REFUNDED"].includes(reservation.status))
        .reduce((sum, reservation) => sum + reservation.quantity, 0) || 0;
      const capacity = config?.tagRule.capacity ?? matchedRule?.capacity ?? 0;

      return {
        id: product.id,
        title: product.title,
        handle: product.handle,
        status: product.status,
        tags: product.tags || [],
        image: product.featuredMedia?.preview?.image?.url || null,
        variantId: variant?.id || null,
        price: variant?.price || "0.00",
        inventoryQuantity: variant?.inventoryQuantity ?? null,
        matchedRule: matchedRule
          ? { id: matchedRule.id, tag: matchedRule.tag, capacity: matchedRule.capacity }
          : null,
        config: config
          ? {
              id: config.id,
              active: config.active,
              expectedLabel: config.expectedLabel,
              depositPercent: Number(config.depositPercent),
              tag: config.tagRule.tag,
              capacity: config.tagRule.capacity,
              depositProductId: config.depositProductId,
            }
          : null,
        sold,
        remaining: Math.max(0, capacity - sold),
      };
    })
    .filter((product: any) => product.matchedRule || product.config);

  const reservations = await prisma.reservation.findMany({
    where: { shop },
    include: { preorder: { select: { productTitle: true, expectedLabel: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const summary = {
    activeProducts: configs.filter((config) => config.active).length,
    reservations: reservations.filter((reservation) => !["CANCELLED", "REFUNDED"].includes(reservation.status)).length,
    pendingBalance: reservations
      .filter((reservation) => !["CANCELLED", "REFUNDED", "BALANCE_PAID"].includes(reservation.status))
      .reduce((sum, reservation) => sum + Number(reservation.balanceTotal), 0),
  };

  return {
    shop,
    rules: rules.map((rule) => ({ ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() })),
    products,
    reservations: reservations.map((reservation) => ({
      id: reservation.id,
      orderName: reservation.shopifyOrderName,
      productTitle: reservation.preorder.productTitle,
      expectedLabel: reservation.preorder.expectedLabel,
      quantity: reservation.quantity,
      depositTotal: Number(reservation.depositTotal),
      balanceTotal: Number(reservation.balanceTotal),
      status: reservation.status,
      email: reservation.customerEmail,
      createdAt: reservation.createdAt.toISOString(),
    })),
    summary,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  try {
    if (intent === "save-rule") {
      const tag = String(form.get("tag") || "").trim();
      const capacity = Number(form.get("capacity"));
      if (!tag) return { ok: false, error: "Informe a tag da pré-venda." };
      if (!Number.isInteger(capacity) || capacity < 1) {
        return { ok: false, error: "A quantidade precisa ser um número inteiro maior que zero." };
      }

      await prisma.preorderTagRule.upsert({
        where: { shop_tag: { shop, tag } },
        update: { capacity, active: true },
        create: { shop, tag, capacity },
      });
      return { ok: true, message: `Regra ${tag} salva com ${capacity} unidades.` };
    }

    if (intent === "disable-rule") {
      const ruleId = String(form.get("ruleId") || "");
      await prisma.preorderTagRule.updateMany({
        where: { id: ruleId, shop },
        data: { active: false },
      });
      return { ok: true, message: "Regra desativada." };
    }

    if (intent === "configure") {
      const productId = String(form.get("productId") || "");
      const ruleId = String(form.get("ruleId") || "");
      const expectedLabel = String(form.get("expectedLabel") || "").trim();
      const depositPercent = Number(form.get("depositPercent") || 20);

      if (!expectedLabel) return { ok: false, error: "Informe a previsão de envio desse produto." };
      if (!Number.isFinite(depositPercent) || depositPercent <= 0 || depositPercent >= 100) {
        return { ok: false, error: "A entrada deve ficar entre 0 e 100%." };
      }

      const rule = await prisma.preorderTagRule.findFirst({ where: { id: ruleId, shop, active: true } });
      if (!rule) return { ok: false, error: "Regra de tag não encontrada." };

      const product = await getProductSnapshot(admin, productId);
      if (!product.tags.includes(rule.tag)) {
        return { ok: false, error: `O produto não possui mais a tag ${rule.tag}.` };
      }

      const existing = await prisma.productPreorder.findFirst({
        where: { shop, shopifyProductId: product.id, shopifyVariantId: product.variant.id },
      });

      const preorder = existing
        ? await prisma.productPreorder.update({
            where: { id: existing.id },
            data: {
              productTitle: product.title,
              tagRuleId: rule.id,
              expectedLabel,
              depositPercent,
              active: true,
            },
          })
        : await prisma.productPreorder.create({
            data: {
              shop,
              shopifyProductId: product.id,
              shopifyVariantId: product.variant.id,
              productTitle: product.title,
              tagRuleId: rule.id,
              expectedLabel,
              depositPercent,
              active: true,
            },
          });

      const deposit = await syncPreorderDeposit({
        admin,
        shop,
        preorderId: preorder.id,
        originalProduct: product,
        capacity: rule.capacity,
        depositPercent,
        expectedLabel,
        existing: preorder,
      });

      await prisma.productPreorder.update({
        where: { id: preorder.id },
        data: {
          depositProductId: deposit.depositProductId,
          depositVariantId: deposit.depositVariantId,
          depositInventoryItemId: deposit.depositInventoryItemId,
        },
      });

      return {
        ok: true,
        message: `${product.title}: pré-venda ativa, ${deposit.remaining} unidade(s) ainda disponíveis.`,
      };
    }

    if (intent === "disable-product") {
      const preorderId = String(form.get("preorderId") || "");
      const preorder = await prisma.productPreorder.findFirst({ where: { id: preorderId, shop } });
      if (!preorder) return { ok: false, error: "Pré-venda não encontrada." };

      await disablePreorderMetafield(admin, preorder.shopifyProductId);
      await prisma.productPreorder.update({ where: { id: preorder.id }, data: { active: false } });
      return { ok: true, message: "Pré-venda desativada para esse produto." };
    }

    return { ok: false, error: "Ação desconhecida." };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error instanceof Error ? error.message : "Erro inesperado." };
  }
};

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export default function PreorderDashboard() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="page">
      <style>{styles}</style>
      <div className="header">
        <div>
          <p className="eyebrow">TOPFUEL · SHOPIFY</p>
          <h1>Pré-vendas</h1>
          <p className="muted">Tag controla somente a quantidade. A previsão continua individual em cada produto.</p>
        </div>
      </div>

      {actionData && (
        <div className={actionData.ok ? "notice success" : "notice error"}>
          {actionData.ok ? actionData.message : actionData.error}
        </div>
      )}

      <div className="stats">
        <div className="stat"><span>Produtos ativos</span><strong>{data.summary.activeProducts}</strong></div>
        <div className="stat"><span>Reservas</span><strong>{data.summary.reservations}</strong></div>
        <div className="stat"><span>Saldo a receber</span><strong>{money(data.summary.pendingBalance)}</strong></div>
      </div>

      <section className="card">
        <div className="sectionTitle">
          <div><h2>Regras por tag</h2><p>Ex.: <code>Prevenda2</code> pode significar 3 unidades disponíveis por produto.</p></div>
        </div>
        <Form method="post" className="ruleForm">
          <input type="hidden" name="intent" value="save-rule" />
          <label>Tag<input name="tag" placeholder="Prevenda2" required /></label>
          <label>Quantidade<input name="capacity" type="number" min="1" defaultValue="3" required /></label>
          <button className="primary" disabled={busy}>Salvar regra</button>
        </Form>
        <div className="ruleList">
          {data.rules.map((rule) => (
            <div className="rule" key={rule.id}>
              <div><strong>{rule.tag}</strong><span>{rule.capacity} unidade(s) por produto</span></div>
              <Form method="post">
                <input type="hidden" name="intent" value="disable-rule" />
                <input type="hidden" name="ruleId" value={rule.id} />
                <button className="ghost" disabled={busy}>Desativar</button>
              </Form>
            </div>
          ))}
          {!data.rules.length && <p className="empty">Crie a primeira regra de tag.</p>}
        </div>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div><h2>Produtos encontrados</h2><p>Mostramos produtos que possuem alguma tag configurada acima.</p></div>
        </div>
        <div className="products">
          {data.products.map((product) => {
            const rule = product.matchedRule;
            return (
              <div className="product" key={product.id}>
                <div className="productInfo">
                  {product.image ? <img src={product.image} alt="" /> : <div className="placeholder" />}
                  <div>
                    <h3>{product.title}</h3>
                    <p>{money(Number(product.price))} · Shopify: {product.inventoryQuantity ?? "—"} em estoque</p>
                    <div className="badges">
                      {(rule || product.config) && <span className="badge cyan">PRÉ-VENDA</span>}
                      {product.config?.expectedLabel && <span className="badge yellow">PREVISÃO: {product.config.expectedLabel}</span>}
                    </div>
                  </div>
                </div>

                <div className="numbers">
                  <div><span>Tag</span><strong>{rule?.tag || product.config?.tag || "—"}</strong></div>
                  <div><span>Limite</span><strong>{rule?.capacity ?? product.config?.capacity ?? 0}</strong></div>
                  <div><span>Reservado</span><strong>{product.sold}</strong></div>
                  <div><span>Restante</span><strong>{product.remaining}</strong></div>
                </div>

                {rule ? (
                  <Form method="post" className="configForm">
                    <input type="hidden" name="intent" value="configure" />
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <label>Previsão individual
                      <input
                        name="expectedLabel"
                        placeholder="FEV/2027"
                        defaultValue={product.config?.expectedLabel || ""}
                        required
                      />
                    </label>
                    <label>Entrada (%)
                      <input
                        name="depositPercent"
                        type="number"
                        min="1"
                        max="99"
                        step="0.01"
                        defaultValue={product.config?.depositPercent ?? 20}
                        required
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      {product.config?.active ? "Sincronizar" : "Ativar pré-venda"}
                    </button>
                  </Form>
                ) : (
                  <p className="warning">A tag original foi removida. A configuração permanece no histórico.</p>
                )}

                {product.config?.active && (
                  <Form method="post" className="disableForm">
                    <input type="hidden" name="intent" value="disable-product" />
                    <input type="hidden" name="preorderId" value={product.config.id} />
                    <button className="dangerGhost" disabled={busy}>Desativar neste produto</button>
                  </Form>
                )}
              </div>
            );
          })}
          {!data.products.length && <p className="empty">Nenhum produto com as tags cadastradas ainda.</p>}
        </div>
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>Últimas reservas</h2><p>Pedidos pagos identificados pelos webhooks da Shopify.</p></div></div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Pedido</th><th>Produto</th><th>Qtd.</th><th>Entrada</th><th>Saldo</th><th>Previsão</th><th>Status</th></tr></thead>
            <tbody>
              {data.reservations.map((reservation) => (
                <tr key={reservation.id}>
                  <td>{reservation.orderName || "—"}</td>
                  <td>{reservation.productTitle || "—"}</td>
                  <td>{reservation.quantity}</td>
                  <td>{money(reservation.depositTotal)}</td>
                  <td>{money(reservation.balanceTotal)}</td>
                  <td>{reservation.expectedLabel || "—"}</td>
                  <td><span className="status">{reservation.status}</span></td>
                </tr>
              ))}
              {!data.reservations.length && <tr><td colSpan={7} className="empty">Nenhuma reserva paga ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const styles = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f6f6f7; color: #202223; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .page { max-width: 1180px; margin: 0 auto; padding: 28px 24px 60px; }
  .header { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; margin-bottom:22px; }
  h1 { font-size: 32px; margin: 2px 0 8px; letter-spacing:-.03em; }
  h2 { font-size: 20px; margin: 0 0 5px; }
  h3 { font-size: 16px; margin: 0 0 7px; }
  p { margin: 0; }
  .eyebrow { font-size: 11px; font-weight: 800; letter-spacing: .12em; color:#616161; }
  .muted, .sectionTitle p, .productInfo p, .rule span { color:#6d7175; font-size:13px; }
  .notice { padding: 12px 14px; border-radius: 10px; margin-bottom: 18px; font-size:14px; font-weight:600; }
  .notice.success { background:#e7f8ee; color:#116329; border:1px solid #9dd9ae; }
  .notice.error { background:#fff0f0; color:#8e1f1f; border:1px solid #edb0b0; }
  .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:18px; }
  .stat { background:#fff; border:1px solid #e1e3e5; border-radius:12px; padding:17px 18px; box-shadow:0 1px 1px rgba(0,0,0,.03); }
  .stat span { color:#6d7175; display:block; font-size:12px; margin-bottom:8px; }
  .stat strong { font-size:22px; }
  .card { background:#fff; border:1px solid #e1e3e5; border-radius:12px; padding:20px; margin-bottom:18px; box-shadow:0 1px 1px rgba(0,0,0,.03); }
  .sectionTitle { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
  .ruleForm, .configForm { display:grid; grid-template-columns:1.5fr .7fr auto; gap:12px; align-items:end; }
  label { font-size:12px; font-weight:650; color:#4a4a4a; display:grid; gap:6px; }
  input { height:40px; border:1px solid #babfc3; border-radius:8px; padding:0 11px; background:#fff; font:inherit; color:#202223; }
  input:focus { outline:2px solid #005bd3; outline-offset:1px; border-color:#005bd3; }
  button { border:0; border-radius:8px; height:40px; padding:0 15px; font-weight:700; cursor:pointer; }
  button:disabled { opacity:.55; cursor:wait; }
  .primary { color:#fff; background:#202223; }
  .ghost { background:#f2f3f3; color:#3d3d3d; }
  .dangerGhost { background:#fff0f0; color:#8e1f1f; height:34px; }
  .ruleList { margin-top:16px; display:grid; gap:8px; }
  .rule { border:1px solid #e1e3e5; background:#fafbfb; border-radius:9px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; }
  .rule div { display:flex; align-items:center; gap:12px; }
  code { background:#f1f2f3; border-radius:5px; padding:2px 6px; }
  .products { display:grid; gap:12px; }
  .product { border:1px solid #e1e3e5; border-radius:12px; padding:15px; }
  .productInfo { display:flex; gap:13px; align-items:center; }
  .productInfo img, .placeholder { width:66px; height:66px; border-radius:9px; object-fit:cover; background:#f2f3f3; border:1px solid #e1e3e5; }
  .badges { display:flex; gap:6px; margin-top:9px; flex-wrap:wrap; }
  .badge { padding:5px 9px; border-radius:999px; font-size:11px; font-weight:800; }
  .cyan { background:#dff7fb; color:#076b78; }
  .yellow { background:#fff2b9; color:#725600; }
  .numbers { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:15px 0; }
  .numbers div { background:#f7f8f8; border-radius:8px; padding:9px 10px; }
  .numbers span { display:block; color:#777; font-size:10px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:3px; }
  .numbers strong { font-size:14px; }
  .disableForm { margin-top:10px; display:flex; justify-content:flex-end; }
  .warning { color:#8a6116; background:#fff8e5; border-radius:8px; padding:10px; font-size:13px; }
  .tableWrap { overflow:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#6d7175; font-size:11px; text-transform:uppercase; letter-spacing:.04em; border-bottom:1px solid #e1e3e5; padding:9px; }
  td { border-bottom:1px solid #f0f0f0; padding:11px 9px; }
  .status { background:#f1f2f3; border-radius:999px; padding:4px 8px; font-size:10px; font-weight:800; }
  .empty { color:#8c9196; padding:18px 2px; text-align:center; }
  @media (max-width: 760px) {
    .page { padding:18px 12px 40px; }
    .stats { grid-template-columns:1fr; }
    .ruleForm, .configForm { grid-template-columns:1fr; }
    .numbers { grid-template-columns:repeat(2,1fr); }
  }
`;
