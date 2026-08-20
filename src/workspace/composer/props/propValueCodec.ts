/**
 * Re-export shared prop codec (kinds must survive serialize round-trip).
 */
export {
  commitBooleanValue,
  commitStringValue,
  decodeAttr,
  encodeAttr,
  isBooleanChecked,
  isOpaquePropValue,
  stringFieldDisplay,
} from "../../../../shared/composer/propValueCodec"
