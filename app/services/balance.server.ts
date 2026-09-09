import prisma from "../db.server";

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function assertNoUserErrors(errors: Array<{ message: string }> | undefined, operation: string) {
  if (errors?.length) {
    throw new Error(`${operation}: ${errors.map((error) => error.message).join("; ")}`);
  }
}

export async function createAndSendBalanceInvoice(args: {
  admin: AdminClient;
  shop: string;
  reservationId: string;
  shippingAmount?: number;
}) {
  const { admin, shop, reservationId } = args;
  const shippingAmount = Math.max(0, Number(args.shippingAmount || 0));

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, shop },
    include: { preorder: true },
  });

  if (!reservation) throw new Error("Reserva não encontrada.");
  if (["CANCELLED", "REFUNDED", "BALANCE_PAID"].includes(reservation.status)) {
    throw new Error("Essa reserva não pode receber uma nova cobrança de saldo.");
  }

  let draftOrderId = reservation.balanceDraftOrderId;
  let invoiceUrl = reservation.balanceInvoiceUrl;

  if (!draftOrderId) {
    const balance = Number(reservation.balanceTotal);
    const input: Record<string, unknown> = {
      email: reservation.customerEmail || undefined,
      note: `Saldo da pré-venda ${reservation.shopifyOrderName || ""} - ${reservation.preorder.productTitle || "Produto"}`,
      tags: ["PRE-VENDA", "SALDO-PRE-VENDA", `PREORDER-${reservation.id}`],
      lineItems: [
        {
          title: `Saldo - ${reservation.preorder.productTitle || "Pré-venda"}`,
          quantity: 1,
          originalUnitPriceWithCurrency: {
            amount: balance.toFixed(2),
            currencyCode: "BRL",
          },
          requiresShipping: true,
          taxable: false,
          customAttributes: [
            { key: "_balance_reservation_id", value: reservation.id },
            { key: "Pedido da reserva", value: reservation.shopifyOrderName || reservation.shopifyOrderId },
          ],
        },
      ],
      customAttributes: [
        { key: "_balance_reservation_id", value: reservation.id },
        { key: "preorder_source_order", value: reservation.shopifyOrderId },
      ],
    };

    if (shippingAmount > 0) {
      input.shippingLine = {
        title: "Frete",
        price: shippingAmount.toFixed(2),
      };
    }

    const createResponse = await admin.graphql(
      `#graphql
        mutation CreateBalanceDraft($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder { id name invoiceUrl }
            userErrors { field message }
          }
        }
      `,
      { variables: { input } },
    );
    const createBody = await createResponse.json() as any;
    assertNoUserErrors(createBody.data?.draftOrderCreate?.userErrors, "Falha ao criar cobrança do saldo");
    const draftOrder = createBody.data?.draftOrderCreate?.draftOrder;
    if (!draftOrder) throw new Error("A Shopify não retornou o pedido de cobrança do saldo.");

    draftOrderId = draftOrder.id;
    invoiceUrl = draftOrder.invoiceUrl || null;
  }

  if (reservation.customerEmail) {
    const sendResponse = await admin.graphql(
      `#graphql
        mutation SendBalanceInvoice($id: ID!, $email: EmailInput) {
          draftOrderInvoiceSend(id: $id, email: $email) {
            draftOrder { id invoiceUrl }
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          id: draftOrderId,
          email: {
            to: reservation.customerEmail,
            subject: `Sua pré-venda chegou - ${reservation.preorder.productTitle || "TopFuel Garage"}`,
            customMessage: `Sua pré-venda ${reservation.shopifyOrderName || ""} chegou. Finalize o pagamento do saldo para seguirmos com o envio.`,
          },
        },
      },
    );
    const sendBody = await sendResponse.json() as any;
    assertNoUserErrors(sendBody.data?.draftOrderInvoiceSend?.userErrors, "Falha ao enviar cobrança por e-mail");
    invoiceUrl = sendBody.data?.draftOrderInvoiceSend?.draftOrder?.invoiceUrl || invoiceUrl;
  }

  await prisma.reservation.update({
    where: { id: reservation.id },
    data: {
      shippingAmount,
      balanceDraftOrderId: draftOrderId,
      balanceInvoiceUrl: invoiceUrl,
      status: "BALANCE_INVOICED",
    },
  });

  return {
    draftOrderId,
    invoiceUrl,
    emailSent: Boolean(reservation.customerEmail),
    total: Number(reservation.balanceTotal) + shippingAmount,
  };
}
