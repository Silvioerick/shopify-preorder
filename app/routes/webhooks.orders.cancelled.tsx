import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);
  const order = payload as any;

  await prisma.reservation.updateMany({
    where: {
      shop,
      shopifyOrderId: String(order.id),
      status: { not: "BALANCE_PAID" },
    },
    data: { status: "CANCELLED" },
  });

  return new Response(null, { status: 200 });
};
