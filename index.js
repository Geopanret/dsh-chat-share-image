/**
 * dsh-chat-share-image — Host half.
 *
 * The feature is entirely a browser-side rendering job: the Client half clones
 * the rendered assistant reply, rasterizes it to a long PNG and writes it to
 * the system clipboard. There is no Host service, route, session event or tool
 * to register, so this half only satisfies the bundle row's entry contract.
 */
export function apply() {}
