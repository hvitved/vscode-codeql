import * as React from 'react';
import { ResultTableProps } from './result-table-utils';
import { InterpretedResultSet, GraphInterpretationData } from '../pure/interface-types';
import { graphviz } from 'd3-graphviz';

export type GraphProps = ResultTableProps & { resultSet: InterpretedResultSet<GraphInterpretationData> };

const className = 'vscode-codeql__result-tables-graph';

export class Graph extends React.Component<GraphProps> {
  constructor(props: GraphProps) {
    super(props);
  }

  public render = (): JSX.Element => {
    return <div id={className} className={className} />;
  };

  public componentDidMount = () => {
    this.renderGraph();
  };

  public componentDidUpdate = () => {
    this.renderGraph();
  };

  private renderGraph = () => {
    const options = {
      fit: true,
      fade: false,
      growEnteringEdges: false,
      zoom: true,
    };

    graphviz(`#${className}`)
      .options(options)
      .renderDot(this.props.resultSet.interpretation.data.dot);
  };
}
