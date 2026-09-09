import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

type Property = { name?: string; value?: string };

function propertyValue(properties: Property[] | undefined, name: string) {
  return properties?.find((property) => property.name === name)?.value || null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);
  const order = payload as any;
  const orderId = String(order.id);
  const orderName = order.name ? String(order.name) : null;
  const customerId = order.customer?.id ? String(order.customer.id) : null;
  const customerEmail = order.email || order.customer?.email || null;

  for (const lineItem of order.line_items || []) {
    const preorderId = propertyValue(lineItem.properties, "_preorder_id");
    if (!preorderId) continue;

    const preorder = await prisma.productPreorder.findFirst({
      where: { id: preorderId, shop, active: true },
    });
    if (!preorder) continue;

    const quantity = Math.max(1, Number(lineItem.quantity || 1));
    const depositUnitPrice = Number(lineItem.price || 0);
    const originalCents = Number(propertyValue(lineItem.properties, "_original_unit_price") || 0);
    const originalUnitPrice = originalCents > 0
      ? originalCents / 100
      : depositUnitPrice / (Number(preorder.depositPercent) / 100);
    const balanceUnitPrice = Math.max(0, originalUnitPrice - depositUnitPrice);

    await prisma.reservation.upsert({
      where: {
        shop_shopifyOrderId_preorderId: {
          shop,
          shopifyOrderId: orderId,
          preorderId,
        },
      },
      update: {
        shopifyLineItemId: lineItem.id ? String(lineItem.id) : null,
        shopifyOrderName: orderName,
        shopifyCustomerId: customerId,
        customerEmail,
        quantity,
        originalUnitPrice,
        depositUnitPrice,
        balanceUnitPrice,
        depositTotal: depositUnitPrice * quantity,
        balanceTotal: balanceUnitPrice * quantity,
        status: "WAITING_PRODUCT",
      },
      create: {
        shop,
        preorderId,
        shopifyOrderId: orderId,
        shopifyLineItemId: lineItem.id ? String(lineItem.id) : null,
        shopifyOrderName: orderName,
        shopifyCustomerId: customerId,
        customerEmail,
        quantity,
        originalUnitPrice,
        depositUnitPrice,
        balanceUnitPrice,
        depositTotal: depositUnitPrice * quantity,
        balanceTotal: balanceUnitPrice * quantity,
        status: "WAITING_PRODUCT",
      },
    });
  }

  return new Response(null, { status: 200 });
};
