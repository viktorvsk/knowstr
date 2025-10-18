import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import RelayExtractor from "../src/relay_extractor.js";

describe("RelayExtractor", () => {
  describe("Valid WebSocket URLs", () => {
    it("should extract standard ws:// URLs", () => {
      const events = [{
        tags: [["r", "", "ws://relay.example.com"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay.example.com"]);
    });

    it("should extract standard wss:// URLs", () => {
      const events = [{
        tags: [["r", "", "wss://relay.example.com"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["wss://relay.example.com"]);
    });

    it("should extract URLs with ports", () => {
      const events = [{
        tags: [["r", "", "ws://relay.example.com:8080"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay.example.com:8080"]);
    });

    it("should handle IPv4 addresses in colon-separated format", () => {
      const events = [{
        tags: [["r", "", "ws://192:168:1:1:3000"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://192.168.1.1:3000"]);
    });

    it("should handle IPv6 addresses", () => {
      const events = [{
        tags: [["r", "", "wss://2001:db8::1:8080"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["wss://[2001:db8::1]:8080"]);
    });

    it("should handle IPv6 addresses without brackets", () => {
      const events = [{
        tags: [["r", "", "wss://2001:db8::1"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["wss://[2001:db8::1]"]);
    });

    it("should handle onion addresses", () => {
      const events = [{
        tags: [["r", "", "ws://nlmymyoxcuahgqdsc64d5rsfpi3ahb4aji7t4xu24xnzpp75cdrv6wad.onion:50001"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://nlmymyoxcuahgqdsc64d5rsfpi3ahb4aji7t4xu24xnzpp75cdrv6wad.onion:50001"]);
    });

    it("should remove trailing slashes", () => {
      const events = [{
        tags: [["r", "", "ws://relay.example.com/"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay.example.com"]);
    });

    it("should preserve query parameters", () => {
      const events = [{
        tags: [["r", "", "ws://relay.example.com?param=value"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay.example.com?param=value"]);
    });
  });

  describe("Valid HTTP/HTTPS URLs", () => {
    it("should extract HTTP URLs", () => {
      const events = [{
        tags: [["r", "", "http://relay.example.com"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["http://relay.example.com"]);
    });

    it("should extract HTTPS URLs", () => {
      const events = [{
        tags: [["r", "", "https://relay.example.com"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["https://relay.example.com"]);
    });

    it("should handle URLs without protocol", () => {
      const events = [{
        tags: [["r", "", "www.newscientist.com/article/2476660-one-off-gene-editing-therapy-could-permanently-lower-cholesterol/?utm_term=autofeed&utm_campaign=echobox&utm_medium=social&utm_source=twitter"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });
  });

  describe("Hash and suffix stripping", () => {
    it("should strip hash fragments", () => {
      const events = [{
        tags: [["r", "", "ws://relay.example.com#fragment"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay.example.com"]);
    });

    it("should strip :t: suffix", () => {
      const events = [{
        tags: [["r", "", "ws://relay.example.com:8080:t:"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay.example.com:8080"]);
    });

    it("should strip :s: suffix", () => {
      const events = [{
        tags: [["r", "", "ws://relay.example.com:8080:s:"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay.example.com:8080"]);
    });

    it("should handle URLs with hash fragments", () => {
      const events = [{
        tags: [["r", "", "learning.chaincode.com/#boss:"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should handle URLs with hash fragments and protocol", () => {
      const events = [{
        tags: [["r", "", "https://nos.lol/#grownostr:"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["https://nos.lol"]);
    });

    it("should handle onion URLs with :t: suffix", () => {
      const events = [{
        tags: [["r", "", "ws://nlmymyoxcuahgqdsc64d5rsfpi3ahb4aji7t4xu24xnzpp75cdrv6wad.onion:50001:t:"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://nlmymyoxcuahgqdsc64d5rsfpi3ahb4aji7t4xu24xnzpp75cdrv6wad.onion:50001"]);
    });
  });

  describe("IPv6 handling", () => {
    it("should handle complex IPv6 addresses", () => {
      const events = [{
        tags: [["r", "", "wss://200:3210:1603:658e:19a6:434f:43dd:d03f:"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["wss://[200:3210:1603:658e:19a6:434f:43dd:d03f]"]);
    });

    it("should handle IPv6 with port", () => {
      const events = [{
        tags: [["r", "", "wss://2001:db8::1:8080"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["wss://[2001:db8::1]:8080"]);
    });
  });

  describe("Invalid URLs", () => {
    it("should reject URLs with invalid protocols", () => {
      const events = [{
        tags: [["r", "", "ftp://relay.example.com"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should reject URLs with invalid port numbers", () => {
      const events = [{
        tags: [["r", "", "ws://relay.example.com:abc"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should reject URLs without hostname", () => {
      const events = [{
        tags: [["r", "", "ws://"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should reject malformed URLs", () => {
      const events = [{
        tags: [["r", "", "not-a-url"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should reject URLs with invalid characters", () => {
      const events = [{
        tags: [["r", "", "ws://relay.example.com/\u0000"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty events array", () => {
      const result = RelayExtractor.perform([]);
      assert.deepEqual(result, []);
    });

    it("should handle events with no tags", () => {
      const events = [{ kind: 10002 }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should handle events with empty tags", () => {
      const events = [{
        tags: [],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should handle non-string URLs", () => {
      const events = [{
        tags: [["r", "", 123]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should handle URLs with newlines", () => {
      const events = [{
        tags: [["r", "", "ws://relay1.example.com\nws://relay2.example.com"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay1.example.com", "ws://relay2.example.com"]);
    });

    it("should handle URLs with commas", () => {
      const events = [{
        tags: [["r", "", "ws://relay1.example.com,ws://relay2.example.com"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay1.example.com", "ws://relay2.example.com"]);
    });

    it("should handle URLs with spaces", () => {
      const events = [{
        tags: [["r", "", "ws://relay1.example.com ws://relay2.example.com"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay1.example.com", "ws://relay2.example.com"]);
    });

    it("should deduplicate URLs", () => {
      const events = [{
        tags: [["r", "", "ws://relay.example.com"], ["r", "", "ws://relay.example.com"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay.example.com"]);
    });

    it("should handle kind 3 events", () => {
      const events = [{
        kind: 3,
        content: '{"ws://relay.example.com": {"read": true, "write": true}}'
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay.example.com"]);
    });

    it("should handle a, e, p tags", () => {
      const events = [{
        tags: [
          ["a", "", "ws://relay1.example.com"],
          ["e", "", "ws://relay2.example.com"],
          ["p", "", "ws://relay3.example.com"]
        ]
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://relay1.example.com", "ws://relay2.example.com", "ws://relay3.example.com"]);
    });
  });

  describe("Specific test cases from requirements", () => {
    it("should handle newscientist.com URL", () => {
      const events = [{
        tags: [["r", "", "www.newscientist.com/article/2476660-one-off-gene-editing-therapy-could-permanently-lower-cholesterol/?utm_term=autofeed&utm_campaign=echobox&utm_medium=social&utm_source=twitter#echobox=1744929955"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should handle IPv6 WebSocket URL", () => {
      const events = [{
        tags: [["r", "", "wss://200:3210:1603:658e:19a6:434f:43dd:d03f:"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["wss://[200:3210:1603:658e:19a6:434f:43dd:d03f]"]);
    });

    it("should handle chaincode.com URL", () => {
      const events = [{
        tags: [["r", "", "learning.chaincode.com/#boss:"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should handle nos.lol URL", () => {
      const events = [{
        tags: [["r", "", "nos.lol/#grownostr:"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, []);
    });

    it("should handle onion URL with suffix", () => {
      const events = [{
        tags: [["r", "", "ws://nlmymyoxcuahgqdsc64d5rsfpi3ahb4aji7t4xu24xnzpp75cdrv6wad.onion:50001:t:"]],
        kind: 10002
      }];
      const result = RelayExtractor.perform(events);
      assert.deepEqual(result, ["ws://nlmymyoxcuahgqdsc64d5rsfpi3ahb4aji7t4xu24xnzpp75cdrv6wad.onion:50001"]);
    });
  });
});
