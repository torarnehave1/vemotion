# Vegvisr Knowledge Graph API With `curl`

Base URL:

```bash
KG=https://knowledge.vegvisr.org
```

OpenAPI:

```bash
curl "$KG/openapi.json"
```

If your endpoint requires auth, add this header to the commands below:

```bash
-H "X-API-Token: YOUR_TOKEN"
```

## Best practice

Use this flow:

1. Create the graph with `saveGraphWithHistory`
2. Add nodes with `addNode`
3. Read the graph back with `getknowgraph`
4. Edit later with `patchNode`

## 1. Create a graph

```bash
curl -X POST "$KG/saveGraphWithHistory" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "graph_my_first_test",
    "graphData": {
      "metadata": {
        "title": "My First Test Graph",
        "description": "Created with curl",
        "category": "demo",
        "metaArea": "#TEST"
      },
      "nodes": [],
      "edges": []
    },
    "override": true
  }'
```

## 2. Add a fulltext node

```bash
curl -X POST "$KG/addNode" \
  -H "Content-Type: application/json" \
  -d '{
    "graphId": "graph_my_first_test",
    "node": {
      "id": "node_intro",
      "label": "# Introduction",
      "type": "fulltext",
      "color": "#1d3557",
      "info": "This is the first node in the graph.",
      "metadata": {
        "origin": "curl"
      },
      "bibl": []
    }
  }'
```

## 3. Add an image node

```bash
curl -X POST "$KG/addNode" \
  -H "Content-Type: application/json" \
  -d '{
    "graphId": "graph_my_first_test",
    "node": {
      "id": "node_image_1",
      "label": "Example Image",
      "type": "markdown-image",
      "info": "Alt text for the image",
      "path": "https://vegvisr.imgix.net/1778324142798-1.svg",
      "color": "#457b9d",
      "metadata": {
        "origin": "curl"
      },
      "bibl": []
    }
  }'
```

## 4. Read the graph back

```bash
curl "$KG/getknowgraph?id=graph_my_first_test"
```

## 5. Patch a node later

```bash
curl -X POST "$KG/patchNode" \
  -H "Content-Type: application/json" \
  -d '{
    "graphId": "graph_my_first_test",
    "nodeId": "node_intro",
    "fields": {
      "label": "# Updated Introduction",
      "info": "This node was updated with curl."
    }
  }'
```

## Notes

- Use `saveGraphWithHistory` for graph-level create/save.
- Use `addNode` for new nodes.
- Use `patchNode` for edits.
- For `fulltext` nodes, put the content in `info`.
- For `markdown-image` nodes, put the URL in `path` and the alt text in `info`.
- Keep labels human-readable.
