import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);
  const product = payload as any;
  const productId = `gid://shopify/Product/${product.id}`;

  await prisma.productPreorder.updateMany({
    where: { shop, shopifyProductId: productId },
    data: { productTitle: product.title ? String(product.title) : undefined },
  });

  return new Response(null, { status: 200 });
};
