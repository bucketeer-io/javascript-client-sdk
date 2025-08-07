import { RuleTester } from 'eslint'
import rule from './no-spread-after-defaults.js'

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

ruleTester.run('no-spread-after-defaults', rule.rules['no-spread-after-defaults'], {
  valid: [
    // Empty object
    {
      code: 'const obj = {}',
    },
    
    // Only properties
    {
      code: `const obj = {
        name: 'defaultName',
        age: 25,
        active: true
      }`,
    },
    
    // Single spread at beginning
    {
      code: `const obj = {
        ...userOptions,
        name: 'defaultName',
        age: 25
      }`,
    },
    
    // Single spread only
    {
      code: 'const obj = { ...userOptions }',
    },
    
    // Computed property with spread first
    {
      code: `const obj = {
        ...options,
        [key]: 'value'
      }`,
    },
    
    // Method with spread first
    {
      code: `const obj = {
        ...options,
        method() { return 'value' }
      }`,
    },
  ],

  invalid: [
    // Spread after regular property
    {
      code: `const obj = {
        name: 'defaultName',
        ...userOptions
      }`,
      errors: [{
        message: 'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
        type: 'SpreadElement',
      }],
    },
    
    // Spread after computed property
    {
      code: `const obj = {
        [key]: 'value',
        ...userOptions
      }`,
      errors: [{
        message: 'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
        type: 'SpreadElement',
      }],
    },
    
    // Spread after method
    {
      code: `const obj = {
        getValue() { return 'default' },
        ...userOptions
      }`,
      errors: [{
        message: 'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
        type: 'SpreadElement',
      }],
    },
    
    // Spread after another spread (your case)
    {
      code: `const obj = {
        ...base,
        ...fields
      }`,
      errors: [{
        message: 'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
        type: 'SpreadElement',
      }],
    },
    
    // Multiple spreads after first spread
    {
      code: `const obj = {
        ...obj1,
        ...obj2,
        ...obj3
      }`,
      errors: [
        {
          message: 'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
          type: 'SpreadElement',
        },
        {
          message: 'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
          type: 'SpreadElement',
        },
      ],
    },
    
    // Mixed case: property, spread, property, spread
    {
      code: `const obj = {
        name: 'default',
        ...base,
        age: 25,
        ...userOptions
      }`,
      errors: [
        {
          message: 'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
          type: 'SpreadElement',
        },
        {
          message: 'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
          type: 'SpreadElement',
        },
      ],
    },
    
    // Real-world TypeScript case (our EventCreators pattern)
    {
      code: `const newEvaluationEvent = (base, fields) => {
        return {
          ...base,
          ...fields,
          '@type': 'EvaluationEvent'
        }
      }`,
      errors: [{
        message: 'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
        type: 'SpreadElement',
      }],
    },
    
    // Spread after property with final property
    {
      code: `const obj = {
        name: 'default',
        ...userOptions,
        '@type': 'Event'
      }`,
      errors: [{
        message: 'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
        type: 'SpreadElement',
      }],
    },
  ],
})

console.log('✅ no-spread-after-defaults tests completed successfully')
