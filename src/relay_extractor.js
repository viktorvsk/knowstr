import URIValidator from "node-uri";

/** Responsible for extracting relays URLs from different event kinds based */
class RelayExtractor {
  static #rawUrlsFromEvents(events) {
    const rawUrls = [];

    events.forEach((event) => {
      try {
        rawUrls.push(...event.tags.filter((t) => ["a", "e", "p"].includes(t[0])).map((t) => t[2]));
      } catch (error) {
        // TODO: Handle errors
      }

      if (event.kind === 10002) {
        try {
          rawUrls.push(...event.tags.filter((t) => t[0] === "r").map((t) => t.slice(-1)[0]));
        } catch (error) {
          // TODO: Handle errors
        }
      }

      if (event.kind === 3) {
        try {
          rawUrls.push(...Object.keys(JSON.parse(event.content)));
        } catch (error) {
          // TODO: Handle errors
        }
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
        const parsedURL = URIValidator.checkURI(url);
        if (parsedURL.valid && parsedURL.host && ["ws", "wss", "http", "https"].includes(parsedURL.scheme)) {
          decodeURIComponent(url);
          btoa(url);
          urls.push(url);
        }
      } catch (error) {
        return;
      }
    });

    return [...new Set(urls)];
  }
}

export default RelayExtractor;
