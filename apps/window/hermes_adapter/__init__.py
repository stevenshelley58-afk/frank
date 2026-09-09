"""Frank adapter for the Hermes v0.21 runtime.

Narrow server-side boundary: Frank forwards typed commands and displays every
event Hermes actually emits; Hermes remains the only brain.  Modules owned by
the adapter session; shared contracts stay in ``tool_apps`` (Session 1).
"""
