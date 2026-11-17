-- Seedream adapters treat base_url as the API root and append /images/generations.
-- Connections saved with the full endpoint therefore request a doubled path at
-- runtime. Strip the suffix so existing connections keep working after upgrade.
UPDATE provider_connections
SET base_url = rtrim(
  substr(
    rtrim(base_url, '/'),
    1,
    length(rtrim(base_url, '/')) - length('/images/generations')
  ),
  '/'
)
WHERE adapter = 'seedream'
  AND rtrim(base_url, '/') LIKE '%/images/generations';

-- Handle a previously doubled suffix in the same migration.
UPDATE provider_connections
SET base_url = rtrim(
  substr(
    rtrim(base_url, '/'),
    1,
    length(rtrim(base_url, '/')) - length('/images/generations')
  ),
  '/'
)
WHERE adapter = 'seedream'
  AND rtrim(base_url, '/') LIKE '%/images/generations';
