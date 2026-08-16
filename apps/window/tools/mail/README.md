# Mail

`home_snapshot.py` projects only already-authorized, provider-neutral sync
status, aggregate projection counts, opaque receipt references, and recorded
connection-capability coverage. It performs no I/O, stores no provider state,
and has no field for message bodies, addresses, credentials, or send actions.

Mail owns canonical provider-neutral thread/message projections, sync cursors, delivery receipts, and reply/bounce/complaint/unsubscribe events. Providers own raw bodies and delivery execution. Mail exposes compose/reply intent through Hermes, never a raw browser/provider send command.
