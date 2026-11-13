/**
 * @xie00000/myshop-pos
 *
 * Public entry point of the package. The core logic originally written for
 * Cloudflare Workers is re-exported here so it can be consumed from Node.js
 * (or any runtime that supports the Web Fetch API and Web Crypto API).
 */

import worker from "./src/worker.js";
import {
  SESSION_COOKIE,
  json,
  readJson,
  toHex,
  fromHex,
  randomHex,
  timingSafeEqual,
  hashPassword,
  hmacHex,
  getCookie,
  signSession,
  verifySession,
  getSession,
  getShopByUser,
  isValidEmail,
  isValidDate,
  todayString,
  parseIntStrict,
  handleApi,
} from "./src/worker.js";
import { templates, getTemplate, listTemplates } from "./src/templates.js";

export {
  worker,
  SESSION_COOKIE,
  json,
  readJson,
  toHex,
  fromHex,
  randomHex,
  timingSafeEqual,
  hashPassword,
  hmacHex,
  getCookie,
  signSession,
  verifySession,
  getSession,
  getShopByUser,
  isValidEmail,
  isValidDate,
  todayString,
  parseIntStrict,
  handleApi,
  templates,
  getTemplate,
  listTemplates,
};

export default worker;
