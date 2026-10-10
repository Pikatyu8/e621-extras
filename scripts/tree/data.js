E621X.define('treeData', ['net'], (Net) => {
  'use strict';
  const IDS_PER_REQUEST = 100;
  const PARENT_SEARCH_LIMIT = 320;

  const unwrapPost = (data) => data.post || data;
  const unwrapList = (data) => (Array.isArray(data) ? data : (data.posts || []));

  const fetchPost = async (id) => unwrapPost(await Net.fetchJson(`/posts/${id}.json`));

  async function fetchByIds(ids) {
    const found = [];
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + IDS_PER_REQUEST);
      found.push(...unwrapList(await Net.fetchJson(`/posts.json?tags=id:${chunk.join(',')}&limit=${IDS_PER_REQUEST}`)));
    }
    return found;
  }

  const fetchByParent = async (parentId) =>
    unwrapList(await Net.fetchJson(`/posts.json?tags=parent:${parentId}&limit=${PARENT_SEARCH_LIMIT}`));

  /* Walks up to the root, then down breadth-first.
   * Partial failures do not abort the tree; they are reported in `warnings`. */
  async function fetchFullTree(startPostId) {
    const warnings = [];

    let root;
    try {
      root = await fetchPost(startPostId);
    } catch (err) {
      throw new Error(`Post #${startPostId} not found (${err.message})`);
    }

    const visitedUp = new Set([root.id]);
    while (root.relationships?.parent_id) {
      const parentId = root.relationships.parent_id;
      if (visitedUp.has(parentId)) break;
      visitedUp.add(parentId);
      try {
        root = await fetchPost(parentId);
      } catch (err) {
        warnings.push(`parent #${parentId}: ${err.message}`);
        break;
      }
    }

    const postsMap = new Map([[root.id, root]]);
    const seen = new Set([root.id]);
    const queue = [root];

    while (queue.length) {
      const current = queue.shift();
      if (!current.relationships?.has_children) continue;

      const declared = current.relationships.children || [];
      const idsToFetch = declared.filter(id => !seen.has(id));
      idsToFetch.forEach(id => seen.add(id));

      let fetched = [];
      try {
        if (declared.length) {
          fetched = idsToFetch.length ? await fetchByIds(idsToFetch) : [];
        } else {
          fetched = await fetchByParent(current.id);
        }
      } catch (err) {
        warnings.push(`children of #${current.id}: ${err.message}`);
      }

      for (const post of fetched) {
        if (postsMap.has(post.id)) continue;
        seen.add(post.id);
        postsMap.set(post.id, post);
        queue.push(post);
      }
    }

    return { rootId: root.id, postsMap, warnings };
  }

  function buildHierarchy(rootId, postsMap) {
    const nodes = new Map();
    for (const [id, post] of postsMap) nodes.set(id, { post, children: [] });

    const root = nodes.get(rootId);
    if (!root) return null;

    for (const [id, node] of nodes) {
      if (id === rootId) continue;
      const parentId = node.post.relationships?.parent_id;
      (parentId && nodes.has(parentId) ? nodes.get(parentId) : root).children.push(node);
    }

    const sortSubtree = (n) => {
      n.children.sort((a, b) => a.post.id - b.post.id);
      n.children.forEach(sortSubtree);
    };
    sortSubtree(root);
    return root;
  }

  return { fetchFullTree, buildHierarchy, fetchByIds };

});