-- The website is never limited by the app: "full reading only in the app" is retired.
-- Any issue that had app_only = 1 is opened up again on the web. The column stays (additive-only migrations).
UPDATE issues SET app_only = 0 WHERE app_only <> 0;
