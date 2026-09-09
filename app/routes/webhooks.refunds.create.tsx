import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);
  const refund = payload as any;

  if (refund.order_id) {
    await prisma.reservation.updateMany({
      where: {
        shop,
        shopifyOrderId: String(refund.order_id),
        status: { not: "BALANCE_PAID" },
      },
      data: { status: "REFUNDED" },
    });
  }

  return new Response(null, { status: 200 });
};
