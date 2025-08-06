# Custom ESLint Rules

## no-spread-after-defaults

This rule prevents spreading objects after default properties in object literals to avoid unintentional override of defaults with `undefined` values.

### Why this rule exists

When you spread an object after defining default properties, any `undefined` values in the spread object will override your carefully set defaults. This can lead to subtle bugs where your fallback values are unexpectedly replaced with `undefined`.

### Examples

#### ✅ Allowed Cases

**1. Spreading before any properties:**
```javascript
const obj = {
  ...userOptions,     // Spread first
  name: 'defaultName',
  age: 25
}
```

**2. Only properties (no spreading):**
```javascript
const obj = {
  name: 'defaultName',
  age: 25,
  active: true
}
```

**3. Empty object:**
```javascript
const obj = {}
```

#### ❌ Disallowed Cases

**1. Spreading after regular properties:**
```javascript
const obj = {
  name: 'defaultName',  // Default property
  ...userOptions        // ❌ Could override with undefined
}
```

**2. Spreading after computed properties:**
```javascript
const obj = {
  [dynamicKey]: 'value',  // Default property
  ...userOptions          // ❌ Could override with undefined
}
```

**3. Spreading after methods:**
```javascript
const obj = {
  getValue() { return 'default' },  // Default property
  ...userOptions                    // ❌ Could override with undefined
}
```

**4. Spreading after other spread elements:**
```javascript
const obj = {
  ...baseConfig,    // Default property (spread)
  ...userOptions    // ❌ Could override with undefined
}
```

**5. Multiple consecutive spreads:**
```javascript
const obj = {
  ...obj1,     // Default property
  ...obj2,     // ❌ Flagged: comes after obj1
  ...obj3      // ❌ Flagged: comes after obj1 and obj2
}
```

### The Problem

Consider this problematic code:
```javascript
// Dangerous: if userOptions.name is undefined, it overrides the default
const config = {
  name: 'defaultName',
  timeout: 5000,
  ...userOptions  // userOptions.name could be undefined!
}

// If userOptions = { name: undefined, retries: 3 }
// Result: { name: undefined, timeout: 5000, retries: 3 }
//         ^^^^^^^^^^^^^^^^^ Default was overridden!
```

### Better Alternatives

**Option 1: Spread first, then set defaults**
```javascript
const config = {
  ...userOptions,
  name: userOptions.name ?? 'defaultName',
  timeout: userOptions.timeout ?? 5000
}
```

**Option 2: Use nullish coalescing**
```javascript
const config = {
  name: userOptions.name ?? 'defaultName',
  timeout: userOptions.timeout ?? 5000,
  ...userOptions  // Only for non-conflicting properties
}
```

**Option 3: Filter undefined values**
```javascript
const cleanOptions = Object.fromEntries(
  Object.entries(userOptions).filter(([_, value]) => value !== undefined)
)
const config = {
  name: 'defaultName',
  timeout: 5000,
  ...cleanOptions
}
```

### When to disable this rule

You can disable this rule when:

1. **Type safety guarantees no undefined values** (like with TypeScript `Omit` types):
```typescript
// Safe: TypeScript ensures fields cannot contain BaseEvent properties
const event = {
  ...base,
  // eslint-disable-next-line custom-rules/no-spread-after-defaults
  ...fields,  // TypeScript guarantees no property conflicts
  '@type': 'EvaluationEvent'
}
```

2. **You explicitly want undefined to override defaults**:
```javascript
// Intentional: undefined should override defaults
const config = {
  enabled: true,
  // eslint-disable-next-line custom-rules/no-spread-after-defaults
  ...userSettings  // User can explicitly disable with undefined
}
```

### Rule Configuration

This rule has no configuration options. It will flag any spread element that appears after any property (regular, computed, method, or spread) in an object literal.
