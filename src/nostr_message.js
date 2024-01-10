import { initNostrWasm } from "nostr-wasm";

const nw = await initNostrWasm();

export default class NostrMessage {
  static parse(data) {
    let json;
    const instance = new NostrMessage();
    try {
      json = JSON.parse(data);
    } catch (error) {
      instance.isValid = false;
    }

    const command = json[0];

    instance.command = command;

    switch (command) {
      case "CLOSE":
        instance.sid = json[1];
        break;
      case "EVENT":
        // TODO: validate schema/payload
        try {
          nw.verifyEvent(json[2]);
          instance.event = json[2];
          instance.sid = json[1];
        } catch (err) {
          instance.isValid = false;
        }

        break;
      case "EOSE":
        instance.sid = json[1];
    }

    if (typeof instance.isValid === "undefined") {
      instance.isValid = true;
    }

    return instance;
  }
}
