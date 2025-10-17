import URIValidator from "node-uri";

/** Responsible for extracting relays URLs from different event kinds based */
class RelayExtractor {
  static #rawUrlsFromEvents(events) {
    const rawUrls = [];

    events.forEach((event) => {
      try {
        rawUrls.push(...event.tags.filter((t) => ["a", "e", "p"].includes(t[0])).map((t) => t[2]));
      } catch (error) {}

      if (event.kind === 10002) {
        try {
          rawUrls.push(...event.tags.filter((t) => t[0] === "r").map((t) => t.slice(-1)[0]));
        } catch (error) {}
      }

      if (event.kind === 3) {
        try {
          rawUrls.push(...Object.keys(JSON.parse(event.content)));
        } catch (error) {}
      }
    });

    return [
      ...new Set(
        rawUrls
          .filter((url) => typeof url === "string")
          .map((url) => url.split("\n"))
          .flat()
          .map((url) => url.split(","))
          .flat()
          .map((url) => url.split(" "))
          .flat()
          .filter((url) => typeof url === "string")
          .map((url) =>
            url
              .trim()
              .toLowerCase()
              .replace(/\s/, "")
              .replace(/#.*$/, "")
              .replace(/(\/)+$/gi, ""),
          ),
      ),
    ];
  }

  /**
   * @param {Object[]} events list of Nostr events
   * @return {string[]} list of relays URLs
   * */
  static perform(events) {
    const urls = [];
    const rawUrls = RelayExtractor.#rawUrlsFromEvents(events);

    rawUrls.forEach((url) => {
      try {
        let u = url;
        u = u.replace(/:(\d+):(t|s)\b:*/i, ":$1");
        u = u.replace(/^((?:ws|wss|http|https):\/\/)(\d{1,3}):(\d{1,3}):(\d{1,3}):(\d{1,3})(:\d+)?/i, (_, proto, a, b, c, d, port) => `${proto}${a}.${b}.${c}.${d}${port || ""}`);
        u = u.replace(/^((?:ws|wss|http|https):\/\/)(?!\[)([0-9a-f:]{2,})(?![^/]*\])/i, (_, proto, host) => `${proto}[${host}]`);
        u = u.replace(/#.*$/, "");

        const parsedURL = URIValidator.checkURI(u);
        if (parsedURL.valid && parsedURL.host && ["ws", "wss", "http", "https"].includes(parsedURL.scheme)) {
          if (!parsedURL.hostname) { return; }
          if (parsedURL.port && !/^\d+$/.test(parsedURL.port)) { return; }
          decodeURIComponent(u);
          btoa(u);
          urls.push(u);
        }
      } catch (error) {
        return;
      }
    });

    return [...new Set(urls)];
  }
}

export default RelayExtractor;
