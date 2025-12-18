# Polar Integration Documentation

## Overview

This document covers how to integrate Polar.sh for billing in the PR Visual GitHub App.

## Key Concepts

### Checkout Links vs Checkout Sessions

**Checkout Links** (what we were using):
- Static, shareable URLs created in Polar dashboard or via API
- Reusable - same link for multiple customers
- **DO NOT support `customer_external_id` as a query parameter**
- Only support these query params:
  - `customer_email` - prefill email
  - `customer_name` - prefill name
  - `discount_code` - prefill discount
  - `amount` - for pay-what-you-want pricing
  - `custom_field_data.{slug}` - custom fields
  - UTM params (`utm_source`, `utm_medium`, `utm_campaign`, etc.)

**Checkout Sessions** (what we need):
- Created programmatically via API for each checkout
- Single-use, expires after completion or timeout
- **DOES support `externalCustomerId`** parameter
- Returns a `url` to redirect the customer to

### Customer External ID

The `external_id` field on Polar customers links them to your system's identifiers.

- Set via `externalCustomerId` when creating a checkout session
- After successful checkout, Polar creates a Customer with this external_id
- Query customers by external_id: `polar.customers.getExternal({ externalId: "xxx" })`

## SDK Reference

### Creating a Checkout Session

```typescript
import { Polar } from "@polar-sh/sdk";

const polar = new Polar({ accessToken: process.env.POLAR_API_KEY });

const checkout = await polar.checkouts.create({
  // Required: array of product IDs
  products: ["prod_xxx", "prod_yyy"],

  // Link to your system's user/installation ID
  externalCustomerId: "github_installation_123",

  // Pre-fill customer info (optional)
  customerEmail: "user@example.com",
  customerName: "John Doe",

  // Redirect after payment
  successUrl: "https://your-app.com/success?checkout_id={CHECKOUT_ID}",

  // Metadata copied to resulting order/subscription
  metadata: {
    source: "github_app_install"
  }
});

// Redirect customer to checkout
console.log(checkout.url);
```

### CheckoutCreate Parameters

From `@polar-sh/sdk` types:

| Parameter | Type | Description |
|-----------|------|-------------|
| `products` | `string[]` | **Required.** List of product IDs |
| `externalCustomerId` | `string \| null` | Your system's customer ID. Creates/links Polar customer |
| `customerId` | `string \| null` | Existing Polar customer ID (pre-fills form) |
| `customerEmail` | `string \| null` | Pre-fill email |
| `customerName` | `string \| null` | Pre-fill name |
| `customerBillingAddress` | `AddressInput \| null` | Pre-fill billing address |
| `successUrl` | `string \| null` | Redirect URL after payment. Supports `{CHECKOUT_ID}` |
| `returnUrl` | `string \| null` | Shows back button to this URL |
| `metadata` | `object` | Key-value pairs copied to order/subscription |
| `customerMetadata` | `object` | Key-value pairs copied to created customer |
| `discountId` | `string \| null` | Pre-apply a discount |
| `allowDiscountCodes` | `boolean` | Allow customer to enter codes (default: true) |
| `requireBillingAddress` | `boolean` | Require full address (default: false) |

### Looking Up Customers

```typescript
// By external ID (your system's ID)
const customer = await polar.customers.getExternal({
  externalId: "github_installation_123"
});

// Get full customer state (subscriptions, benefits)
const state = await polar.customers.getStateExternal({
  externalId: "github_installation_123"
});
```

### Customer Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `customers.getExternal` | `GET /v1/customers/external/{external_id}` | Get by external ID |
| `customers.updateExternal` | `PATCH /v1/customers/external/{external_id}` | Update by external ID |
| `customers.deleteExternal` | `DELETE /v1/customers/external/{external_id}` | Delete by external ID |
| `customers.getStateExternal` | `GET /v1/customers/external/{external_id}/state` | Get subscriptions/benefits |

## Webhooks

Polar sends webhooks for various events:

### Relevant Events

| Event | When |
|-------|------|
| `checkout.created` | Checkout session created |
| `checkout.updated` | Checkout session updated |
| `order.created` | Order placed (one-time or first subscription) |
| `order.paid` | Payment confirmed |
| `subscription.created` | Subscription created |
| `subscription.active` | Subscription became active |
| `subscription.canceled` | Subscription canceled |
| `customer.created` | Customer record created |

### Webhook Payload

Webhooks include `customer.external_id` if set during checkout.

## Implementation for PR Visual

### The Flow

```
GitHub App Installed
        ↓
GET /setup?installation_id=123
        ↓
Worker creates checkout session via API:
  polar.checkouts.create({
    products: [FREE_PRODUCT_ID, PRO_PRODUCT_ID],
    externalCustomerId: "123",
    successUrl: "https://worker/success"
  })
        ↓
Redirect to checkout.url
        ↓
User completes checkout (picks Free or Pro)
        ↓
Polar creates Customer with external_id = "123"
        ↓
Redirect to /success
        ↓
Later: PR webhook comes in with installation_id=123
        ↓
Worker calls polar.customers.getExternal({ externalId: "123" })
        ↓
Customer found → proceed with generation
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `POLAR_API_KEY` | Polar access token with required scopes |
| `POLAR_FREE_PRODUCT_ID` | Product ID for Free tier |
| `POLAR_PRO_PRODUCT_ID` | Product ID for Pro tier |

### Required Scopes

- `checkouts:write` - Create checkout sessions
- `customers:read` - Look up customers by external ID

## Why Not Checkout Links?

We initially tried appending `?customer_external_id=xxx` to checkout links. This doesn't work because:

1. Checkout links don't support this query parameter
2. Only checkout sessions (API-created) support `externalCustomerId`
3. The parameter was silently ignored, creating customers without external_id

## Alternative: Store Mapping Ourselves

Instead of using Polar's external_id, we could:

1. Listen for `order.created` webhook after checkout
2. Store `installation_id → polar_customer_id` in D1
3. Look up in our DB when checking billing

This adds complexity but doesn't rely on getting the external_id through checkout.

## References

- [Polar Checkout API](https://polar.sh/docs/features/checkout/session)
- [Polar Checkout Links](https://polar.sh/docs/features/checkout/links)
- [Polar Customers](https://polar.sh/docs/features/customer)
- [Polar Webhooks](https://polar.sh/docs/integrate/webhooks)
- [Polar SDK](https://github.com/polarsource/polar-js)
