# Mail

Mail owns canonical provider-neutral thread/message projections, sync cursors, delivery receipts, and reply/bounce/complaint/unsubscribe events. Providers own raw bodies and delivery execution. Mail exposes compose/reply intent through Hermes, never a raw browser/provider send command.
