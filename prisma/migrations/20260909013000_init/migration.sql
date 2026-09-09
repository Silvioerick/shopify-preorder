-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('DEPOSIT_PAID', 'WAITING_PRODUCT', 'BALANCE_PENDING', 'BALANCE_INVOICED', 'BALANCE_PAID', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreorderTagRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PreorderTagRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductPreorder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "productTitle" TEXT,
    "tagRuleId" TEXT NOT NULL,
    "expectedAt" TIMESTAMP(3),
    "expectedLabel" TEXT,
    "depositPercent" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "depositProductId" TEXT,
    "depositVariantId" TEXT,
    "depositInventoryItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductPreorder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT,
    "shopifyOrderName" TEXT,
    "shopifyCustomerId" TEXT,
    "customerEmail" TEXT,
    "quantity" INTEGER NOT NULL,
    "originalUnitPrice" DECIMAL(12,2) NOT NULL,
    "depositUnitPrice" DECIMAL(12,2) NOT NULL,
    "balanceUnitPrice" DECIMAL(12,2) NOT NULL,
    "depositTotal" DECIMAL(12,2) NOT NULL,
    "balanceTotal" DECIMAL(12,2) NOT NULL,
    "shippingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ReservationStatus" NOT NULL DEFAULT 'DEPOSIT_PAID',
    "balanceDraftOrderId" TEXT,
    "balanceInvoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PreorderTagRule_shop_tag_key" ON "PreorderTagRule"("shop", "tag");
CREATE INDEX "PreorderTagRule_shop_active_idx" ON "PreorderTagRule"("shop", "active");
CREATE UNIQUE INDEX "ProductPreorder_shop_shopifyProductId_shopifyVariantId_key" ON "ProductPreorder"("shop", "shopifyProductId", "shopifyVariantId");
CREATE INDEX "ProductPreorder_shop_active_idx" ON "ProductPreorder"("shop", "active");
CREATE INDEX "ProductPreorder_tagRuleId_idx" ON "ProductPreorder"("tagRuleId");
CREATE UNIQUE INDEX "Reservation_shop_shopifyOrderId_preorderId_key" ON "Reservation"("shop", "shopifyOrderId", "preorderId");
CREATE INDEX "Reservation_shop_status_idx" ON "Reservation"("shop", "status");
CREATE INDEX "Reservation_preorderId_idx" ON "Reservation"("preorderId");
CREATE INDEX "Reservation_shopifyOrderId_idx" ON "Reservation"("shopifyOrderId");

ALTER TABLE "ProductPreorder" ADD CONSTRAINT "ProductPreorder_tagRuleId_fkey" FOREIGN KEY ("tagRuleId") REFERENCES "PreorderTagRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES "ProductPreorder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
