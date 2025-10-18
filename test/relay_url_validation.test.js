import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import RelayExtractor from "../src/relay_extractor.js";

describe("RelayExtractor URL Validation", () => {
  describe("validate() method", () => {
    it("should validate standard WebSocket URLs", () => {
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com"), true);
      assert.strictEqual(RelayExtractor.validate("wss://relay.example.com"), true);
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com:8080"), true);
      assert.strictEqual(RelayExtractor.validate("wss://relay.example.com:8080"), true);
    });

    it("should validate HTTP/HTTPS URLs", () => {
      assert.strictEqual(RelayExtractor.validate("http://relay.example.com"), true);
      assert.strictEqual(RelayExtractor.validate("https://relay.example.com"), true);
      assert.strictEqual(RelayExtractor.validate("http://relay.example.com:8080"), true);
      assert.strictEqual(RelayExtractor.validate("https://relay.example.com:8080"), true);
    });

    it("should validate IPv4 addresses in colon-separated format", () => {
      assert.strictEqual(RelayExtractor.validate("ws://192:168:1:1:3000"), true);
      assert.strictEqual(RelayExtractor.validate("wss://10:0:0:1:8080"), true);
    });

    it("should validate IPv6 addresses", () => {
      assert.strictEqual(RelayExtractor.validate("wss://[2001:db8::1]"), true);
      assert.strictEqual(RelayExtractor.validate("wss://[2001:db8::1]:8080"), true);
      assert.strictEqual(RelayExtractor.validate("wss://2001:db8::1"), true);
      assert.strictEqual(RelayExtractor.validate("wss://2001:db8::1:8080"), true);
    });

    it("should validate complex IPv6 addresses", () => {
      assert.strictEqual(RelayExtractor.validate("wss://200:3210:1603:658e:19a6:434f:43dd:d03f:"), true);
    });

    it("should validate onion addresses", () => {
      assert.strictEqual(RelayExtractor.validate("ws://nlmymyoxcuahgqdsc64d5rsfpi3ahb4aji7t4xu24xnzpp75cdrv6wad.onion:50001"), true);
    });

    it("should validate URLs with query parameters", () => {
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com?param=value"), true);
      assert.strictEqual(RelayExtractor.validate("wss://relay.example.com:8080?param=value"), true);
    });

    it("should handle URLs with :t: and :s: suffixes", () => {
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com:8080:t:"), true);
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com:8080:s:"), true);
    });

    it("should reject URLs without protocol", () => {
      assert.strictEqual(RelayExtractor.validate("relay.example.com"), false);
      assert.strictEqual(RelayExtractor.validate("www.example.com"), false);
      assert.strictEqual(RelayExtractor.validate("example.com"), false);
    });

    it("should reject URLs with invalid protocols", () => {
      assert.strictEqual(RelayExtractor.validate("ftp://relay.example.com"), false);
      assert.strictEqual(RelayExtractor.validate("mailto:relay@example.com"), false);
      assert.strictEqual(RelayExtractor.validate("file:///path/to/file"), false);
    });

    it("should reject URLs with hash fragments", () => {
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com#fragment"), true);
      assert.strictEqual(RelayExtractor.validate("wss://relay.example.com#fragment"), true);
    });

    it("should reject malformed URLs", () => {
      assert.strictEqual(RelayExtractor.validate("not-a-url"), false);
      assert.strictEqual(RelayExtractor.validate(""), false);
      assert.strictEqual(RelayExtractor.validate("://"), false);
      assert.strictEqual(RelayExtractor.validate("ws://"), false);
    });

    it("should reject URLs with invalid port numbers", () => {
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com:abc"), false);
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com:99999"), false);
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com:-1"), false);
    });

    it("should reject URLs with invalid characters", () => {
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com/\u0000"), false);
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com/\u0001"), false);
    });

    it("should reject non-string inputs", () => {
      assert.strictEqual(RelayExtractor.validate(null), false);
      assert.strictEqual(RelayExtractor.validate(undefined), false);
      assert.strictEqual(RelayExtractor.validate(123), false);
      assert.strictEqual(RelayExtractor.validate({}), false);
      assert.strictEqual(RelayExtractor.validate([]), false);
    });

    it("should handle edge cases gracefully", () => {
      assert.strictEqual(RelayExtractor.validate("ws://"), false);
      assert.strictEqual(RelayExtractor.validate("ws://:8080"), false);
      assert.strictEqual(RelayExtractor.validate("ws://[invalid"), false);
      assert.strictEqual(RelayExtractor.validate("ws://]invalid"), false);
    });
  });

  describe("perform() method with validation", () => {
    it("should only return valid URLs", () => {
      const events = [{
        tags: [
          ["r", "", "ws://valid.example.com"],
          ["r", "", "invalid-url"],
          ["r", "", "wss://another-valid.example.com"],
          ["r", "", "ftp://invalid-protocol.example.com"]
        ],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://valid.example.com", "wss://another-valid.example.com"]);
    });

    it("should handle mixed valid and invalid URLs", () => {
      const events = [{
        tags: [
          ["r", "", "ws://good1.example.com"],
          ["r", "", "bad-url"],
          ["r", "", "wss://good2.example.com:8080"],
          ["r", "", "http://good3.example.com"],
          ["r", "", "invalid://bad.example.com"]
        ],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://good1.example.com", "wss://good2.example.com:8080", "http://good3.example.com"]);
    });

    it("should deduplicate valid URLs", () => {
      const events = [{
        tags: [
          ["r", "", "ws://duplicate.example.com"],
          ["r", "", "ws://duplicate.example.com"],
          ["r", "", "invalid-url"],
          ["r", "", "ws://duplicate.example.com"]
        ],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://duplicate.example.com"]);
    });

    it("should return empty array for all invalid URLs", () => {
      const events = [{
        tags: [
          ["r", "", "invalid-url"],
          ["r", "", "bad://protocol"],
          ["r", "", "no-protocol.com"]
        ],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });
  });

  describe("Error handling scenarios", () => {
    it("should handle URLs that cause decodeURIComponent to fail", () => {
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com/\u0000"), false);
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com/\u0001"), false);
    });

    it("should handle URLs that cause btoa to fail", () => {
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com/\uD800"), false);
    });

    it("should handle malformed IPv6 addresses", () => {
      assert.strictEqual(RelayExtractor.validate("ws://[invalid-ipv6"), false);
      assert.strictEqual(RelayExtractor.validate("ws://invalid-ipv6]"), false);
      assert.strictEqual(RelayExtractor.validate("ws://[::1:invalid"), false);
    });

    it("should handle URLs with invalid port ranges", () => {
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com:0"), false);
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com:65536"), false);
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com:1023"), false);
    });

    it("should handle very long URLs", () => {
      const longUrl = "ws://" + "a".repeat(10000) + ".example.com";
      assert.strictEqual(RelayExtractor.validate(longUrl), false);
    });

    it("should handle URLs with special characters", () => {
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com/path with spaces"), false);
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com/path\twith\ttabs"), false);
      assert.strictEqual(RelayExtractor.validate("ws://relay.example.com/path\nwith\nnewlines"), false);
    });
  });

  describe("Specific test cases from requirements", () => {
    it("should handle newscientist.com URL", () => {
      assert.strictEqual(RelayExtractor.validate("www.newscientist.com/article/2476660-one-off-gene-editing-therapy-could-permanently-lower-cholesterol/?utm_term=autofeed&utm_campaign=echobox&utm_medium=social&utm_source=twitter#echobox=1744929955"), false);
    });

    it("should handle IPv6 WebSocket URL", () => {
      assert.strictEqual(RelayExtractor.validate("wss://200:3210:1603:658e:19a6:434f:43dd:d03f:"), true);
    });

    it("should handle chaincode.com URL", () => {
      assert.strictEqual(RelayExtractor.validate("learning.chaincode.com/#boss:"), false);
    });

    it("should handle nos.lol URL", () => {
      assert.strictEqual(RelayExtractor.validate("nos.lol/#grownostr:"), false);
    });

    it("should handle onion URL with suffix", () => {
      assert.strictEqual(RelayExtractor.validate("ws://nlmymyoxcuahgqdsc64d5rsfpi3ahb4aji7t4xu24xnzpp75cdrv6wad.onion:50001:t:"), true);
    });
  });
});
