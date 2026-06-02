/**
 * Zod request schemas and validation helper for API routes.
 * Shared error shape: { error: string } with status 400 on validation failure.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  assertSupplierOrderChannel,
  supplierOrderChannelTypeSchema,
} from '@/lib/order/supplier-order-channel';
import { parseSupplierDeliverySchedule } from '@/lib/order/supplier-delivery-schedule';

const yearMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Invalid yearMonth; use YYYY-MM');

/** POST /api/onboarding */
export const onboardingPostSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .transform((s) => s.trim()),
    role: z.enum(['office', 'manager', 'supply'], {
      message: 'Valid role is required (office, manager, supply)',
    }),
    locationId: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      data.role !== 'manager' ||
      (data.locationId && data.locationId.length > 0),
    { message: 'Location is required for manager role', path: ['locationId'] },
  );

/** POST /api/onboarding/approve */
export const onboardingApprovePostSchema = z.object({
  userId: z
    .string()
    .min(1, 'userId is required')
    .transform((s) => s.trim()),
});

/** POST /api/onboarding/reject */
export const onboardingRejectPostSchema = z.object({
  userId: z
    .string()
    .min(1, 'userId is required')
    .transform((s) => s.trim()),
  reason: z
    .string()
    .max(2000)
    .transform((s) => s.trim())
    .optional(),
});

const cosCategorySchema = z.object({
  categoryId: z.string(),
  name: z.string(),
  amount: z.number(),
});

/** POST /api/dashboard/budget */
export const budgetPostSchema = z.object({
  yearMonth: yearMonthSchema.optional(),
  locationIds: z.array(z.string()).optional(),
  budgetRate: z.number().min(0).max(1).optional(),
  referencePeriodMonths: z.number().int().min(0).max(24).optional(),
  referenceData: z
    .object({
      incomeTotal: z.number(),
      cosByCategory: z.array(cosCategorySchema),
    })
    .optional(),
});

/** PATCH /api/dashboard/budget/[locationId] */
export const budgetPatchSchema = z.object({
  yearMonth: yearMonthSchema.optional(),
  budgetRate: z.number().min(0).max(1).optional(),
  referencePeriodMonths: z.number().int().min(0).max(24).optional(),
  referenceData: z
    .object({
      incomeTotal: z.number(),
      cosByCategory: z.array(cosCategorySchema),
    })
    .optional(),
});

/** PATCH /api/dashboard/labor-target/[locationId] */
export const laborTargetPatchSchema = z.object({
  yearMonth: yearMonthSchema.optional(),
  laborBudgetRate: z.number().min(0).max(1).optional(),
  laborReferencePeriodMonths: z.number().int().min(0).max(24).optional(),
});

/** POST /api/dashboard/budget/bulk — bulk update budgets in a year-month range */
export const budgetBulkPatchSchema = z
  .object({
    fromYearMonth: yearMonthSchema,
    toYearMonth: yearMonthSchema,
    budgetRate: z
      .number()
      .min(0)
      .max(1, 'Budget rate must be between 0 and 1 (e.g. 0.33 for 33%)')
      .optional(),
    referencePeriodMonths: z
      .number()
      .int()
      .min(0)
      .max(24, 'Reference period must be between 1 and 24 months')
      .optional(),
  })
  .refine((data) => data.fromYearMonth <= data.toYearMonth, {
    message: 'From month must be before or equal to To month',
    path: ['toYearMonth'],
  });

/** PATCH /api/dashboard/budget/settings */
export const budgetSettingsPatchSchema = z
  .object({
    budgetRate: z
      .number()
      .min(0)
      .max(1, 'budgetRate must be between 0 and 1 (e.g. 0.3 for 30%)')
      .optional(),
    referencePeriodMonths: z
      .number()
      .int()
      .min(0)
      .max(24, 'referencePeriodMonths must be between 1 and 24')
      .optional(),
  })
  .refine(
    (data) =>
      data.budgetRate !== undefined || data.referencePeriodMonths !== undefined,
    { message: 'Provide budgetRate and/or referencePeriodMonths' },
  );

/** PATCH /api/user/[id] */
export const userPatchSchema = z.object({
  name: z
    .string()
    .min(0)
    .transform((s) => s.trim())
    .optional(),
  role: z.enum(['admin', 'office', 'manager', 'supply']).optional(),
  status: z
    .enum(['pending_onboarding', 'pending_approval', 'active', 'rejected'])
    .optional(),
  locationId: z.string().nullable().optional(),
});

/** POST /api/location */
export const locationPostSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .transform((s) => s.trim()),
  name: z
    .string()
    .min(1, 'Name is required')
    .transform((s) => s.trim()),
  realmId: z.string().min(1, 'Realm is required'),
  classId: z.string().nullable().optional(),
  startYearMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
    .nullish(),
  showBudget: z.boolean().optional().default(true),
});

/** PATCH /api/location/[id] */
export const locationPatchSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .transform((s) => s.trim())
    .optional(),
  name: z
    .string()
    .min(1, 'Name is required')
    .transform((s) => s.trim())
    .optional(),
  classId: z.string().nullable().optional(),
  realmId: z.string().min(1, 'Realm is required').optional(),
  startYearMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
    .nullish(),
  showBudget: z.boolean().optional(),
  cloverMerchantId: z.string().nullable().optional(),
  cloverToken: z.string().nullable().optional(),
  orderEmail: z
    .string()
    .trim()
    .email('Invalid email')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
});

export type OnboardingPostBody = z.infer<typeof onboardingPostSchema>;
export type OnboardingApprovePostBody = z.infer<
  typeof onboardingApprovePostSchema
>;
export type OnboardingRejectPostBody = z.infer<
  typeof onboardingRejectPostSchema
>;
export type BudgetPostBody = z.infer<typeof budgetPostSchema>;
export type BudgetPatchBody = z.infer<typeof budgetPatchSchema>;
export type BudgetBulkPatchBody = z.infer<typeof budgetBulkPatchSchema>;
export type BudgetSettingsPatchBody = z.infer<typeof budgetSettingsPatchSchema>;
export type UserPatchBody = z.infer<typeof userPatchSchema>;
export type LocationPostBody = z.infer<typeof locationPostSchema>;
export type LocationPatchBody = z.infer<typeof locationPatchSchema>;

// ===============================
// DELIVERY
// ===============================
/** POST /api/delivery/location */
export const deliveryLocationPostSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .transform((s) => s.trim()),
  address: z
    .string()
    .transform((s) => s.trim())
    .optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  locationId: z.string().nullish(),
});
/** PATCH /api/delivery/location/[id] */
export const deliveryLocationPatchSchema = z.object({
  name: z
    .string()
    .min(1)
    .transform((s) => s.trim())
    .optional(),
  address: z
    .string()
    .transform((s) => s.trim())
    .optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  locationId: z.string().nullish(),
});

/** POST /api/delivery/driver */
export const deliveryDriverPostSchema = z.object({
  userId: z.string().min(1, 'User is required'),
  name: z
    .string()
    .transform((s) => s.trim())
    .optional(),
});
/** PATCH /api/delivery/driver/[id] */
export const deliveryDriverPatchSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim())
    .optional(),
});

/** POST /api/delivery/fixed-schedule */
export const deliveryFixedSchedulePostSchema = z.object({
  driverId: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
});
/** DELETE by driverId + dayOfWeek in body or query */

/** PUT /api/delivery/fixed-schedule/template - set recurring schedule template (stops + tasks) for a driver+weekday */
const fixedScheduleStopSchema = z.object({
  deliveryLocationId: z.string().nullish(),
  name: z.string().min(1),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  tasks: z.array(z.object({ title: z.string().min(1) })).default([]),
});
export const deliveryFixedScheduleTemplatePutSchema = z.object({
  driverId: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  stops: z.array(fixedScheduleStopSchema),
});

/** POST /api/delivery/daily-schedule */
export const deliveryDailySchedulePostSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  driverId: z.string().min(1),
  stops: z.array(
    z.object({
      deliveryLocationId: z.string().nullish(),
      name: z.string().min(1),
      address: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      tasks: z.array(z.object({ title: z.string().min(1) })).default([]),
    }),
  ),
});
/** POST /api/delivery/daily-schedule/from-fixed - create daily schedules from fixed templates for a date */
export const deliveryDailyScheduleFromFixedPostSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  /** When set, only this driver gets a daily schedule from their fixed template. */
  driverId: z.string().min(1).optional(),
});

/** PATCH /api/delivery/daily-schedule/[id] - update stops/tasks order and content */
export const deliveryDailySchedulePatchSchema = z.object({
  stops: z
    .array(
      z.object({
        id: z.string().optional(),
        deliveryLocationId: z.string().nullish(),
        name: z.string().min(1),
        address: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        tasks: z.array(
          z.object({
            id: z.string().optional(),
            title: z.string().min(1),
          }),
        ),
      }),
    )
    .optional(),
});

export type DeliveryLocationPostBody = z.infer<
  typeof deliveryLocationPostSchema
>;
export type DeliveryLocationPatchBody = z.infer<
  typeof deliveryLocationPatchSchema
>;
export type DeliveryDriverPostBody = z.infer<typeof deliveryDriverPostSchema>;
export type DeliveryDriverPatchBody = z.infer<typeof deliveryDriverPatchSchema>;
export type DeliveryFixedSchedulePostBody = z.infer<
  typeof deliveryFixedSchedulePostSchema
>;
export type DeliveryFixedScheduleTemplatePutBody = z.infer<
  typeof deliveryFixedScheduleTemplatePutSchema
>;
export type DeliveryDailySchedulePostBody = z.infer<
  typeof deliveryDailySchedulePostSchema
>;
export type DeliveryDailySchedulePatchBody = z.infer<
  typeof deliveryDailySchedulePatchSchema
>;

/** POST /api/delivery/driver-auth/token - exchange Google id_token or auth code for driver JWT */
export const deliveryDriverAuthTokenPostSchema = z
  .object({
    idToken: z.string().optional(),
    code: z.string().optional(),
    redirectUri: z.string().optional(),
    codeVerifier: z.string().optional(),
  })
  .refine((d) => d.idToken ?? d.code, {
    message: 'idToken or code is required',
  });

/** POST /api/delivery/driver/location - driver GPS update */
export const deliveryDriverLocationPostSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// ─── Supplier ─────────────────────────────────────────────────────────────────

const supplierWritableFieldsSchema = z.object({
  company: z
    .string()
    .min(1, 'Company name is required')
    .transform((s) => s.trim()),
  /** Short code for default PO numbers; empty clears. Falls back to `company` when unset. */
  officePoSupplierCode: z.string().trim().max(40).optional().nullable(),
  shopifyVendorName: z.string().trim().optional().nullable(),
  groupId: z.string().optional().nullable(),
  /** Common supplier instruction shown in Inbox + PO order processing. */
  instruction: z.string().trim().optional().nullable(),
  /** @deprecated legacy field; use `instruction`. */
  notes: z.string().trim().optional().nullable(),
  orderChannelType: supplierOrderChannelTypeSchema(),
  orderChannelPayload: z.unknown(),
  /** Vendor name aliases for ShopifyVendorMapping (handles vendor renames). */
  vendorAliases: z.array(z.string().trim().min(1)).optional(),
  /** Location-aware vendor mapping pairs: (vendorName, optional shopifyLocationGid) → this supplier. */
  locationVendorPairs: z
    .array(
      z.object({
        vendorName: z.string().trim().min(1),
        shopifyLocationGid: z.string().optional().nullable(),
        shopifyLocationName: z.string().optional().nullable(),
      }),
    )
    .optional(),
  /** Parsed server-side with `parseSupplierDeliverySchedule`; null clears. */
  deliverySchedule: z.unknown().optional().nullable(),
});

export const supplierCreateSchema = supplierWritableFieldsSchema.superRefine(
  (data, ctx) => {
    const result = assertSupplierOrderChannel(
      data.orderChannelType,
      data.orderChannelPayload,
    );
    if (!result.ok) {
      for (const issue of result.issues) {
        ctx.addIssue({
          code: 'custom',
          message: issue.message,
          path: ['orderChannelPayload', ...issue.path],
        });
      }
    }
    if (
      data.deliverySchedule != null &&
      !parseSupplierDeliverySchedule(data.deliverySchedule)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid deliverySchedule JSON',
        path: ['deliverySchedule'],
      });
    }
  },
);

export const supplierUpdateSchema = supplierWritableFieldsSchema
  .partial()
  .superRefine((data, ctx) => {
    const hasType = data.orderChannelType !== undefined;
    const hasPayload = data.orderChannelPayload !== undefined;
    if (hasType !== hasPayload) {
      ctx.addIssue({
        code: 'custom',
        message:
          'orderChannelType and orderChannelPayload must both be provided when updating order channel',
        path: ['orderChannelPayload'],
      });
      return;
    }
    if (hasType && data.orderChannelType !== undefined) {
      const result = assertSupplierOrderChannel(
        data.orderChannelType,
        data.orderChannelPayload,
      );
      if (!result.ok) {
        for (const issue of result.issues) {
          ctx.addIssue({
            code: 'custom',
            message: issue.message,
            path: ['orderChannelPayload', ...issue.path],
          });
        }
      }
    }
    if (
      data.deliverySchedule !== undefined &&
      data.deliverySchedule !== null &&
      !parseSupplierDeliverySchedule(data.deliverySchedule)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid deliverySchedule JSON',
        path: ['deliverySchedule'],
      });
    }
  });

/** PATCH /api/order/supplier-groups/[id]/delivery-schedule — bulk update all suppliers in group */
export const supplierGroupBulkDeliveryScheduleSchema = z
  .object({
    deliverySchedule: z.unknown().nullable(),
  })
  .superRefine((data, ctx) => {
    if (
      data.deliverySchedule != null &&
      !parseSupplierDeliverySchedule(data.deliverySchedule)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid deliverySchedule JSON',
        path: ['deliverySchedule'],
      });
    }
  });

// ─── Office: Shopify order edit (Inbox / PO) ─────────────────────────────────

export const shopifyOrderEditOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('setQuantity'),
    shopifyLineItemGid: z.string().min(1),
    quantity: z.number().int().min(0),
    restock: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('setUnitPrice'),
    shopifyLineItemGid: z.string().min(1),
    unitPrice: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('addVariant'),
    variantGid: z.string().min(1),
    quantity: z.number().int().min(1),
    allowDuplicates: z.boolean().optional(),
    unitPriceOverride: z.number().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('addCustomItem'),
    title: z.string().min(1),
    unitPrice: z.number().nonnegative(),
    quantity: z.number().int().min(1),
    taxable: z.boolean().optional(),
    requiresShipping: z.boolean().optional(),
  }),
]);

export const shopifyOrderApplyEditBodySchema = z.object({
  operations: z.array(shopifyOrderEditOperationSchema).min(0),
  costPatches: z
    .array(
      z.object({
        shopifyLineItemGid: z.string().optional(),
        title: z.string().optional(),
        unitCost: z.number().nonnegative(),
      }),
    )
    .optional(),
  variantCatalogUpdates: z
    .array(
      z.object({
        productGid: z.string().min(1),
        variantGid: z.string().min(1),
        price: z.string().min(1),
      }),
    )
    .optional(),
  purchaseOrderId: z.string().min(1).optional(),
  appendLinesFromShopifyOrderLocalId: z.string().min(1).optional(),
  /** When true, skips PO line resync so callers can batch parallel order edits then resync once. */
  deferPurchaseOrderResync: z.boolean().optional(),
});

export const shopifyVariantCatalogUpdatesBodySchema = z.object({
  updates: z
    .array(
      z.object({
        productGid: z.string().min(1),
        variantGid: z.string().min(1),
        price: z.string().min(1),
      }),
    )
    .min(1),
});

export const purchaseOrderResyncFromShopifyBodySchema = z.object({
  appendFromShopifyOrderLocalId: z.string().min(1).optional(),
});

export type ShopifyOrderApplyEditBody = z.infer<
  typeof shopifyOrderApplyEditBodySchema
>;
export type ShopifyOrderEditOperation = z.infer<
  typeof shopifyOrderEditOperationSchema
>;

const shopifyOrderCreateMailingSchema = z.object({
  address1: z.string().trim().min(1, 'Address line 1 is required'),
  address2: z.string().trim().optional().default(''),
  city: z.string().trim().min(1, 'City is required'),
  zip: z.string().trim().min(1, 'Postal / ZIP code is required'),
  countryCode: z
    .string()
    .trim()
    .length(2, 'Use a 2-letter country code (e.g. CA)')
    .transform((s) => s.toUpperCase()),
  provinceCode: z.string().trim().optional().default(''),
  company: z.string().trim().optional().default(''),
  phone: z.string().trim().optional().default(''),
  firstName: z.string().trim().optional().default(''),
  lastName: z.string().trim().optional().default(''),
});

const shopifyOrderCreateLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('variant'),
    variantGid: z.string().trim().min(1),
    quantity: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('custom'),
    title: z.string().trim().min(1, 'Custom item title is required'),
    quantity: z.number().int().min(1),
    unitPrice: z.number().nonnegative(),
    unitCost: z.number().nonnegative().optional().default(0),
    taxable: z.boolean().optional().default(true),
  }),
]);

/** POST /api/shopify/orders/create */
export const shopifyOrderCreateBodySchema = z.object({
  customerShopifyGid: z
    .string()
    .trim()
    .min(1, 'Customer is required')
    .refine((s) => s.startsWith('gid://shopify/Customer/'), {
      message: 'customerShopifyGid must be a Shopify Customer GID',
    }),
  shippingAddress: shopifyOrderCreateMailingSchema,
  billingAddress: shopifyOrderCreateMailingSchema.optional(),
  lineItems: z
    .array(shopifyOrderCreateLineSchema)
    .min(1, 'Add at least one line item'),
  /** Default `shipping` so API-created orders are not marked "Shipping not required" for physical lines. */
  deliveryMethod: z.enum(['shipping', 'pickup']).optional().default('shipping'),
  /** Shop currency; ignored when `deliveryMethod` is `pickup`. */
  shippingFee: z.number().nonnegative().optional().default(0),
  financialStatus: z.enum(['PENDING', 'PAID']).optional(),
  note: z.string().max(5000).optional().nullable(),
});

export type ShopifyOrderCreateBody = z.infer<
  typeof shopifyOrderCreateBodySchema
>;

// ─── Address ─────────────────────────────────────────────────────────────────

export const addressSchema = z.object({
  name: z.string().trim().optional().default(''),
  address1: z.string().trim().min(1, 'Address line 1 is required'),
  address2: z.string().trim().optional().default(''),
  city: z.string().trim().min(1, 'City is required'),
  province: z.string().trim().min(1, 'Province is required'),
  postalCode: z.string().trim().min(1, 'Postal code is required'),
  country: z.string().trim().default('CA'),
});

export type Address = z.infer<typeof addressSchema>;

// ─── Purchase Order ──────────────────────────────────────────────────────────

const purchaseOrderLineItemSchema = z.object({
  sku: z.string().trim().optional().nullable(),
  variantTitle: z.string().trim().optional().nullable(),
  productTitle: z.string().trim().optional().nullable(),
  quantity: z.number().int().min(1),
  itemPrice: z.number().optional().nullable(),
  supplierRef: z.string().trim().optional().nullable(),
  isCustom: z.boolean().optional().default(false),
  /** Hub `ShopifyOrderLineItem.id` (from pre-PO draft). */
  shopifyLineItemId: z.string().trim().optional().nullable(),
  /** Shopify Admin GraphQL LineItem GID. */
  shopifyLineItemGid: z.string().trim().optional().nullable(),
  shopifyVariantGid: z.string().trim().optional().nullable(),
  shopifyProductGid: z.string().trim().optional().nullable(),
  /** When set, stored on the PO line (overrides catalog default at create time). */
  note: z.string().max(4000).optional().nullable(),
});

const shopifyOrderRefSchema = z.object({
  orderNumber: z.string().min(1),
});

export const purchaseOrderCreateSchema = z.object({
  poNumber: z
    .string()
    .min(1, 'PO number is required')
    .transform((s) => s.trim()),
  supplierId: z.string().optional().nullable(),
  currency: z.string().min(1).default('CAD'),
  isAuto: z.boolean().optional().default(false),
  expectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .nullable(),
  comment: z.string().trim().optional().nullable(),
  lineItems: z.array(purchaseOrderLineItemSchema).optional().default([]),
  shopifyOrderRefs: z.array(shopifyOrderRefSchema).optional().default([]),
  shippingAddress: addressSchema.optional().nullable(),
  billingAddress: addressSchema.optional().nullable(),
  billingSameAsShipping: z.boolean().optional().default(true),
  /** `public.delivery_location_presets.id` when ship-to came from a preset. */
  deliveryLocationPresetId: z
    .union([z.string().trim().min(1), z.null()])
    .optional(),
  /**
   * When true, creates the PO with hub `status = pending` (PO Pending tab / on hold),
   * same as marking an existing PO pending after lines are linked.
   */
  hubPending: z.boolean().optional().default(false),
});

const purchaseOrderStatusUpdateSchema = z.enum([
  'pending',
  'unfulfilled',
  'partially_fulfilled',
  'fulfilled',
  'completed',
]);

export const purchaseOrderUpdateSchema = z.object({
  poNumber: z
    .string()
    .min(1)
    .transform((s) => s.trim())
    .optional(),
  supplierId: z.string().optional().nullable(),
  currency: z.string().min(1).optional(),
  expectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .nullable(),
  comment: z.string().trim().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
  /** Hub workflow / line fulfillment status (`order.purchase_orders.status`). */
  status: purchaseOrderStatusUpdateSchema.optional(),
  shippingAddress: addressSchema.optional().nullable(),
  billingAddress: addressSchema.optional().nullable(),
  billingSameAsShipping: z.boolean().optional(),
  /** When true, sets `emailDeliveryWaivedAt` to now; when false, clears it. */
  emailDeliveryWaived: z.boolean().optional(),
  deliveryLocationPresetId: z
    .union([z.string().trim().min(1), z.null()])
    .optional(),
});

export type PurchaseOrderCreateBody = z.infer<typeof purchaseOrderCreateSchema>;
export type PurchaseOrderUpdateBody = z.infer<typeof purchaseOrderUpdateSchema>;

// ─── Delivery location presets (many `locations` may share one preset) ─────

export const deliveryLocationPresetCreateSchema = z.object({
  /** `public.locations.id` values that should point at this preset (optional). */
  locationIds: z
    .array(z.string().trim().min(1))
    .max(500)
    .optional()
    .default([]),
  name: z.string().trim().min(1, 'Name is required').max(200),
  company: z.string().trim().optional().nullable(),
  address1: z.string().trim().min(1),
  address2: z.string().trim().optional().nullable(),
  city: z.string().trim().min(1),
  province: z.string().trim().min(1),
  postalCode: z.string().trim().min(1),
  country: z.string().trim().optional().default('CA'),
  lat: z.number().finite().optional().nullable(),
  lng: z.number().finite().optional().nullable(),
});

export const deliveryLocationPresetPatchSchema = z.object({
  locationIds: z.array(z.string().trim().min(1)).max(500).optional(),
  name: z.string().trim().min(1, 'Name is required').max(200).optional(),
  company: z.string().trim().optional().nullable(),
  address1: z.string().trim().min(1).optional(),
  address2: z.string().trim().optional().nullable(),
  city: z.string().trim().min(1).optional(),
  province: z.string().trim().min(1).optional(),
  postalCode: z.string().trim().min(1).optional(),
  country: z.string().trim().optional().nullable(),
  lat: z.number().finite().optional().nullable(),
  lng: z.number().finite().optional().nullable(),
});

export type DeliveryLocationPresetCreateBody = z.infer<
  typeof deliveryLocationPresetCreateSchema
>;
export type DeliveryLocationPresetPatchBody = z.infer<
  typeof deliveryLocationPresetPatchSchema
>;

// ─── Receive (fulfill) line items ─────────────────────────────────────────────

export const receiveLineItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        quantityReceived: z.number().int().min(0),
      }),
    )
    .min(1),
});

export type ReceiveLineItemsBody = z.infer<typeof receiveLineItemsSchema>;

/** PATCH /api/order/purchase-orders/[id]/line-items — per-line PO note (PDF + UI). */
export const purchaseOrderLineItemsNotePatchSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        note: z.string().max(4000).nullable(),
      }),
    )
    .min(1),
});

export type PurchaseOrderLineItemsNotePatchBody = z.infer<
  typeof purchaseOrderLineItemsNotePatchSchema
>;

/** PUT /api/shopify/variant-notes — catalog default note per variant GID. */
export const shopifyVariantOfficeNotePutSchema = z.object({
  shopifyVariantGid: z
    .string()
    .min(1)
    .transform((s) => s.trim()),
  note: z.string().max(8000).nullable(),
});

export type ShopifyVariantOfficeNotePutBody = z.infer<
  typeof shopifyVariantOfficeNotePutSchema
>;

/** POST /api/shopify/orders/office-pending — inbox “on hold” flag on hub `shopify_orders`. */
export const shopifyOrdersOfficePendingPostSchema = z.object({
  shopifyOrderIds: z.array(z.string().trim().min(1)).min(1),
  pending: z.boolean(),
});

export type ShopifyOrdersOfficePendingPostBody = z.infer<
  typeof shopifyOrdersOfficePendingPostSchema
>;

// ─── parseBody ────────────────────────────────────────────────────────────────

/**
 * Parse and validate JSON body. Returns either { data } or { error: NextResponse }.
 * Use: const result = await parseBody(request, schema); if (result.error) return result.error;
 */
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ data: T } | { error: NextResponse }> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return {
      error: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }),
    };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) {
    return { data: parsed.data };
  }
  const formErrors = parsed.error.flatten().formErrors;
  const firstIssue = parsed.error.issues[0];
  const message =
    (formErrors[0] as string | undefined) ??
    (firstIssue && 'message' in firstIssue
      ? (firstIssue as { message: string }).message
      : undefined) ??
    'Validation failed';
  return { error: NextResponse.json({ error: message }, { status: 400 }) };
}
