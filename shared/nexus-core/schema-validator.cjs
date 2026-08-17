'use strict';

function schemaError(message, path = '$') {
  const error = new TypeError(`${path}: ${message}`);
  error.code = 'NEXUS_SCHEMA_INVALID';
  error.path = path;
  return error;
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function cloneAndValidate(schema, value, path = '$') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw schemaError('schema must be an object.', path);
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw schemaError(`must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}.`, path);
  }

  const expected = schema.type;
  if (!expected) throw schemaError('schema.type is required.', path);

  if (expected === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw schemaError('must be an object.', path);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw schemaError('must be a plain object.', path);
    const properties = schema.properties || {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) throw schemaError(`missing required property ${key}.`, path);
    }
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        if (schema.additionalProperties === true) {
          output[key] = entry;
          continue;
        }
        throw schemaError(`unexpected property ${key}.`, path);
      }
      output[key] = cloneAndValidate(properties[key], entry, `${path}.${key}`);
    }
    return output;
  }

  if (expected === 'array') {
    if (!Array.isArray(value)) throw schemaError('must be an array.', path);
    if (schema.minItems !== undefined && value.length < Number(schema.minItems)) throw schemaError(`must contain at least ${schema.minItems} items.`, path);
    if (schema.maxItems !== undefined && value.length > Number(schema.maxItems)) throw schemaError(`must contain at most ${schema.maxItems} items.`, path);
    if (!schema.items) throw schemaError('array schema.items is required.', path);
    return value.map((entry, index) => cloneAndValidate(schema.items, entry, `${path}[${index}]`));
  }

  if (expected === 'string') {
    if (typeof value !== 'string') throw schemaError('must be a string.', path);
    if (schema.minLength !== undefined && value.length < Number(schema.minLength)) throw schemaError(`must be at least ${schema.minLength} characters.`, path);
    if (schema.maxLength !== undefined && value.length > Number(schema.maxLength)) throw schemaError(`must be at most ${schema.maxLength} characters.`, path);
    if (schema.pattern !== undefined && !new RegExp(String(schema.pattern)).test(value)) throw schemaError('does not match the required pattern.', path);
    return value;
  }

  if (expected === 'number' || expected === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (expected === 'integer' && !Number.isInteger(value))) {
      throw schemaError(`must be a finite ${expected}.`, path);
    }
    if (schema.minimum !== undefined && value < Number(schema.minimum)) throw schemaError(`must be >= ${schema.minimum}.`, path);
    if (schema.maximum !== undefined && value > Number(schema.maximum)) throw schemaError(`must be <= ${schema.maximum}.`, path);
    return value;
  }

  if (expected === 'boolean') {
    if (typeof value !== 'boolean') throw schemaError('must be a boolean.', path);
    return value;
  }

  if (expected === 'null') {
    if (value !== null) throw schemaError('must be null.', path);
    return null;
  }

  throw schemaError(`unsupported schema type ${expected}; received ${valueType(value)}.`, path);
}

function validateSchema(schema, value) {
  return cloneAndValidate(schema, value, '$');
}

module.exports = {
  validateSchema
};
