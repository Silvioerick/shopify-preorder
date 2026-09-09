import { randomUUID } from "node:crypto";
import prisma from "../db.server";

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ProductSnapshot = {
  id: string;
  title: string;
  tags: string[];
  status: string;
  variant: {
    id: string;
    legacyResourceId: string;
    price: string;
    inventoryItemId: string;
  };
};

function assertNoUserErrors(errors: Array<{ message: string }> | undefined, operation: string) {
  if (errors?.length) {
    throw new Error(`${operation}: ${errors.map((error) => error.message).join("; ")}`);
  }
}

export async function getProductSnapshot(
  admin: AdminClient,
  productId: string,
): Promise<ProductSnapshot> {
  const response = await admin.graphql(
    `#graphql
      query PreorderProduct($id: ID!) {
        product(id: $id) {
          id
          title
          tags
          status
          variants(first: 1) {
            nodes {
              id
              legacyResourceId
              price
              inventoryItem { id }
            }
          }
        }
      }
    `,
    { variables: { id: productId } },
  );
  const body = await response.json() as any;
  const product = body.data?.product;
  const variant = product?.variants?.nodes?.[0];

  if (!product || !variant) {
    throw new Error("Produto ou variante não encontrado na Shopify.");
  }

  return {
    id: product.id,
    title: product.title,
    tags: product.tags || [],
    status: product.status,
    variant: {
      id: variant.id,
      legacyResourceId: String(variant.legacyResourceId),
      price: String(variant.price),
      inventoryItemId: variant.inventoryItem.id,
    },
  };
}

async function getPrimaryLocation(admin: AdminClient): Promise<string> {
  const response = await admin.graphql(`#graphql
    query PreorderLocations {
      locations(first: 20) {
        nodes { id name isActive }
      }
    }
  `);
  const body = await response.json() as any;
  const locations = body.data?.locations?.nodes || [];
  const location = locations.find((item: any) => item.isActive) || locations[0];
  if (!location) throw new Error("Nenhuma localização de estoque ativa foi encontrada.");
  return location.id;
}

async function createDepositProduct(
  admin: AdminClient,
  title: string,
): Promise<{ productId: string; variantId: string; inventoryItemId: string; numericVariantId: string }> {
  const response = await admin.graphql(
    `#graphql
      mutation CreateDepositProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            variants(first: 1) {
              nodes {
                id
                legacyResourceId
                inventoryItem { id }
              }
            }
          }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        product: {
          title: `Reserva - ${title}`,
          status: "ACTIVE",
          vendor: "TopFuel Preorder",
          productType: "Reserva de pré-venda",
          tags: ["__preorder_deposit"],
        },
      },
    },
  );

  const body = await response.json() as any;
  assertNoUserErrors(body.data?.productCreate?.userErrors, "Falha ao criar produto de reserva");
  const product = body.data?.productCreate?.product;
  const variant = product?.variants?.nodes?.[0];
  if (!product || !variant) throw new Error("A Shopify não retornou a variante da reserva.");

  return {
    productId: product.id,
    variantId: variant.id,
    inventoryItemId: variant.inventoryItem.id,
    numericVariantId: String(variant.legacyResourceId),
  };
}

async function setDepositPrice(
  admin: AdminClient,
  productId: string,
  variantId: string,
  price: string,
) {
  const response = await admin.graphql(
    `#graphql
      mutation SetDepositPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        productId,
        variants: [{ id: variantId, price, inventoryPolicy: "DENY" }],
      },
    },
  );
  const body = await response.json() as any;
  assertNoUserErrors(body.data?.productVariantsBulkUpdate?.userErrors, "Falha ao atualizar valor da entrada");
}

async function enableInventoryTracking(admin: AdminClient, inventoryItemId: string) {
  const response = await admin.graphql(
    `#graphql
      mutation TrackDepositInventory($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id tracked }
          userErrors { field message }
        }
      }
    `,
    { variables: { id: inventoryItemId, input: { tracked: true } } },
  );
  const body = await response.json() as any;
  assertNoUserErrors(body.data?.inventoryItemUpdate?.userErrors, "Falha ao ativar controle de estoque da reserva");
}

async function activateOrSetInventory(
  admin: AdminClient,
  inventoryItemId: string,
  locationId: string,
  quantity: number,
) {
  const activateResponse = await admin.graphql(
    `#graphql
      mutation ActivateDepositInventory($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
        inventoryActivate(
          inventoryItemId: $inventoryItemId,
          locationId: $locationId,
          available: $available
        ) {
          inventoryLevel { id }
          userErrors { field message }
        }
      }
    `,
    { variables: { inventoryItemId, locationId, available: quantity } },
  );
  const activateBody = await activateResponse.json() as any;
  const activateErrors = activateBody.data?.inventoryActivate?.userErrors || [];

  if (!activateErrors.length) return;

  const setResponse = await admin.graphql(
    `#graphql
      mutation SetDepositInventory($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
        inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        input: {
          name: "available",
          reason: "correction",
          quantities: [{
            inventoryItemId,
            locationId,
            quantity,
            changeFromQuantity: null,
          }],
        },
        idempotencyKey: randomUUID(),
      },
    },
  );
  const setBody = await setResponse.json() as any;
  assertNoUserErrors(setBody.data?.inventorySetQuantities?.userErrors, "Falha ao ajustar quantidade da pré-venda");
}

async function publishDepositProduct(admin: AdminClient, productId: string) {
  const response = await admin.graphql(`#graphql
    query PreorderPublications {
      publications(first: 20) { nodes { id name } }
    }
  `);
  const body = await response.json() as any;
  const publications = body.data?.publications?.nodes || [];
  const onlineStore = publications.find((publication: any) =>
    String(publication.name || "").toLowerCase().includes("online store") ||
    String(publication.name || "").toLowerCase().includes("loja virtual"),
  );

  if (!onlineStore) return;

  const publishResponse = await admin.graphql(
    `#graphql
      mutation PublishDepositProduct($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }
    `,
    { variables: { id: productId, input: [{ publicationId: onlineStore.id }] } },
  );
  const publishBody = await publishResponse.json() as any;
  assertNoUserErrors(publishBody.data?.publishablePublish?.userErrors, "Falha ao publicar produto de reserva");
}

async function setPreorderMetafields(
  admin: AdminClient,
  originalProductId: string,
  depositProductId: string,
  preorderId: string,
  expectedLabel: string,
  depositPercent: number,
) {
  const metafields = [
    { ownerId: originalProductId, namespace: "topfuel_preorder", key: "active", type: "boolean", value: "true" },
    { ownerId: originalProductId, namespace: "topfuel_preorder", key: "expected_label", type: "single_line_text_field", value: expectedLabel || "A definir" },
    { ownerId: originalProductId, namespace: "topfuel_preorder", key: "deposit_percent", type: "number_decimal", value: depositPercent.toFixed(2) },
    { ownerId: originalProductId, namespace: "topfuel_preorder", key: "config_id", type: "single_line_text_field", value: preorderId },
    { ownerId: originalProductId, namespace: "topfuel_preorder", key: "deposit_product", type: "product_reference", value: depositProductId },
    { ownerId: depositProductId, namespace: "topfuel_preorder", key: "original_product", type: "product_reference", value: originalProductId },
    { ownerId: depositProductId, namespace: "seo", key: "hidden", type: "number_integer", value: "1" },
  ];

  const response = await admin.graphql(
    `#graphql
      mutation SetPreorderMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key namespace }
          userErrors { field message code }
        }
      }
    `,
    { variables: { metafields } },
  );
  const body = await response.json() as any;
  assertNoUserErrors(body.data?.metafieldsSet?.userErrors, "Falha ao salvar dados da pré-venda no produto");
}

export async function syncPreorderDeposit(args: {
  admin: AdminClient;
  shop: string;
  preorderId: string;
  originalProduct: ProductSnapshot;
  capacity: number;
  depositPercent: number;
  expectedLabel: string;
  existing?: {
    depositProductId: string | null;
    depositVariantId: string | null;
    depositInventoryItemId: string | null;
  } | null;
}) {
  const {
    admin,
    shop,
    preorderId,
    originalProduct,
    capacity,
    depositPercent,
    expectedLabel,
    existing,
  } = args;

  const originalPrice = Number(originalProduct.variant.price);
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    throw new Error("O produto original precisa ter preço maior que zero.");
  }
  const depositPrice = Math.round(originalPrice * depositPercent) / 100;
  if (depositPrice <= 0) throw new Error("O valor calculado da entrada ficou inválido.");

  let depositProductId = existing?.depositProductId || null;
  let depositVariantId = existing?.depositVariantId || null;
  let depositInventoryItemId = existing?.depositInventoryItemId || null;
  let numericVariantId = "";

  if (!depositProductId || !depositVariantId || !depositInventoryItemId) {
    const created = await createDepositProduct(admin, originalProduct.title);
    depositProductId = created.productId;
    depositVariantId = created.variantId;
    depositInventoryItemId = created.inventoryItemId;
    numericVariantId = created.numericVariantId;
  } else {
    const response = await admin.graphql(
      `#graphql
        query DepositVariantLegacyId($id: ID!) {
          productVariant(id: $id) { id legacyResourceId }
        }
      `,
      { variables: { id: depositVariantId } },
    );
    const body = await response.json() as any;
    numericVariantId = String(body.data?.productVariant?.legacyResourceId || "");
  }

  await setDepositPrice(admin, depositProductId, depositVariantId, depositPrice.toFixed(2));
  await enableInventoryTracking(admin, depositInventoryItemId);

  const reserved = await prisma.reservation.aggregate({
    where: {
      shop,
      preorderId,
      status: { notIn: ["CANCELLED", "REFUNDED"] },
    },
    _sum: { quantity: true },
  });
  const remaining = Math.max(0, capacity - (reserved._sum.quantity || 0));
  const locationId = await getPrimaryLocation(admin);
  await activateOrSetInventory(admin, depositInventoryItemId, locationId, remaining);
  await publishDepositProduct(admin, depositProductId);
  await setPreorderMetafields(
    admin,
    originalProduct.id,
    depositProductId,
    preorderId,
    expectedLabel,
    depositPercent,
  );

  return {
    depositProductId,
    depositVariantId,
    depositInventoryItemId,
    numericVariantId,
    depositPrice,
    remaining,
  };
}

export async function disablePreorderMetafield(admin: AdminClient, productId: string) {
  const response = await admin.graphql(
    `#graphql
      mutation DisablePreorder($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        metafields: [{
          ownerId: productId,
          namespace: "topfuel_preorder",
          key: "active",
          type: "boolean",
          value: "false",
        }],
      },
    },
  );
  const body = await response.json() as any;
  assertNoUserErrors(body.data?.metafieldsSet?.userErrors, "Falha ao desativar pré-venda");
}
