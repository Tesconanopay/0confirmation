import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'

const Tab = (props) => {
  const { name, onClick, isActive, tabIndex, className } = props

  return (
    <li
      className={classnames(
        'tab',
        className,
        { 'tab--active': isActive },
      )}
      onClick={(event) => {
        event.preventDefault()
        onClick(tabIndex)
      }}
    >
      { name }
    </li>
  )
}

Tab.propTypes = {
  className: PropTypes.string,
  isActive: PropTypes.bool, // required, but added using React.cloneElement
  name: PropTypes.string.isRequired,
  onClick: PropTypes.func,
  tabIndex: PropTypes.number, // required, but added using React.cloneElement
}

Tab.defaultProps = {
  className: undefined,
  onClick: undefined,
}

export default Tab