const boardOutline = region.boardOutline ?? region.boardEdgeOutline;
      let boardSection;
      if (boardOutline?.length) {
        const boardSectionKey = JSON.stringify([
          String(region.board_edge_margin),
          boardOutline.map(({ x, y }) => [x, y])
        ]);
        boardSection = boardSections.get(boardSectionKey);
        if (!boardSection) {
          boardSection = subtractBlockersFromPour(boardOutline, processObstaclesForPour([], undefined, pourMargins, boardOutline).polygonsToSubtract);
          boardSections.set(boardSectionKey, boardSection);
        }
      }
